// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { StringsView } from './strings-view';
import { StringFiles, stringScheme } from './string-files';
import { DataTypeEditorView } from './type-editor-view';
import * as vscode from 'vscode';
import { countLabel, inlineText, statusAccessibility } from './a11y';
import { ProgramBrowser } from './browser';
import { ProgramContext } from './context';
import { EditingUI } from './editing';
import { Workbench } from './workbench';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import { Call, GhidraMemory, VirtualDocument } from './memory';
import { AnalysisTracker, isOpenSession, SessionsView } from './sessions';
import { formatFriendlyError } from './error';
import { ReadonlyRenames } from './rename';
import { DocumentLabels } from './labels';
import { symbolName, setShowTemplateArguments, displayAddress } from './names';
import { ReferenceViews, referenceScheme, referenceSource } from './references';
import { showCodeActions } from './code-actions';
import { ListingFiles, ListingViews, listingScheme } from './listing';
import { cursorLocation } from './location';
import { plainAddress } from './listing-format';
import { MemoryFiles, memoryAddressAt, memoryScheme } from './bytes';
import { ViewSets } from './views';
import { AnalysisMode, ControlFlowView } from './control-flow-view';
import { singleKeyShortcutsEnabled } from './program-views-controller';
import { DataTypeFiles, typeScheme } from './type-files';
import { installManagedBinaries, resolveOrInstallBinaries, ResolvedBinaries } from './installer';
import {
    extractCandidatePrograms, formatOpenDisplayName, OpenProgramRequest, resolveOpenInput,
} from './open-options';

/** Active LSP language client instance for `ghidra-lsp`. */
let client: LanguageClient | undefined;
/** Active `ghidra/changed` notification subscription for the running LSP client. */
let changedSub: vscode.Disposable | undefined;
/** Navigation commands filtered out of VS Code Code Actions to avoid duplicate items. */
const nativeNavigationCommands = new Set(['ghidraLsp.showReferences', 'ghidraLsp.showCallers', 'ghidraLsp.showCallees', 'ghidraLsp.showCallHierarchy']);
/** Function summary item returned by `ghidra.functions`. */
interface FunctionInfo { name: string; demangled_name?: string; namespace?: string; entry: string }
/** Session summary item returned by `ghidra.sessions`. */
interface SessionInfo { md5: string; status: string; fileName?: string; name?: string }
/** Background binary open or analysis progress payload from `ghidra.analysisStatus`. */
interface AnalysisOperation { token: string; md5: string; state: 'pending' | 'ready' | 'failed'; stage?: string; phase?: string; detail?: string; percentage?: number; error?: string; analyzed: boolean; analysisRunning: boolean }
/** Start the `ghidra-lsp` language server and register all extension views and commands. */
export async function activate(extension: vscode.ExtensionContext): Promise<void> {
    let renames: ReadonlyRenames;
    let references: ReferenceViews;
    const output = vscode.window.createOutputChannel('Ghidra LSP');
    extension.subscriptions.push(output);
    const config = vscode.workspace.getConfiguration('ghidraLsp');
    setShowTemplateArguments(config.get('templateArguments') === 'show');
    const createClientOptions = (mcpCommand: string): LanguageClientOptions => {
        const current = vscode.workspace.getConfiguration('ghidraLsp');
        return {
            // Reference views of Listing rows are not decompiler documents; only decompiled and Markdown ones reach the server.
            documentSelector: [{ scheme: 'ghidra' }, { scheme: referenceScheme, language: 'ghidra-decompiled' }, { scheme: referenceScheme, language: 'markdown' }],
            outputChannel: output,
            uriConverters: {
                code2Protocol: uri => (referenceSource(uri) || uri).toString(),
                protocol2Code: uri => vscode.Uri.parse(uri),
            },
            middleware: {
                didOpen: async (document, next) => { if (document.uri.scheme !== referenceScheme) { await next(document); } },
                didChange: async (event, next) => { if (event.document.uri.scheme !== referenceScheme) { await next(event); } },
                didClose: async (document, next) => { if (document.uri.scheme !== referenceScheme) { await next(document); } },
                didSave: async (document, next) => { if (!['ghidra', referenceScheme].includes(document.uri.scheme)) { await next(document); } },
                provideReferences: async (document, position, context, token, next) => {
                    const locations = await next(document, position, context, token);
                    return locations && references ? references.locations(locations, token, document.uri) : locations;
                },
                provideCodeActions: async (document, range, context, token, next) => {
                    const actions = await next(document, range, context, token);
                    return actions?.filter(action => !nativeNavigationCommands.has(typeof action.command === 'string' ? action.command : action.command?.command || ''));
                },
                provideCodeLenses: async (document, token, next) => {
                    const lenses = await next(document, token);
                    return lenses?.filter(lens => !lens.command || !nativeNavigationCommands.has(lens.command.command));
                },
                provideRenameEdits: async (document, position, name, token, next) => {
                    const edit = await next(document, position, name, token);
                    renames?.schedule(document.uri.authority);
                    return edit;
                },
            },
            initializationOptions: {
                readonlyDocuments: true,
                mcpCommand, mcpArgs: current.get('mcpArgs'),
                requestTimeoutMs: current.get('requestTimeoutMs'),
                templateArguments: current.get('templateArguments'),
            },
        };
    };
    let startup: Promise<void> | undefined;
    const requests = new Map<string, Set<Promise<unknown>>>();
    const call: Call = async <T>(command: string, args: object = {}): Promise<T> => {
        if (!client) { throw new Error('Ghidra LSP has stopped'); }
        if (startup) { await startup; }
        const resource = args as { md5?: unknown; uri?: unknown };
        const md5 = typeof resource.md5 === 'string' ? resource.md5
            : typeof resource.uri === 'string' && resource.uri.startsWith('ghidra:') ? vscode.Uri.parse(resource.uri).authority : undefined;
        const operation = client.sendRequest<T>('workspace/executeCommand', { command, arguments: [args] });
        if (!md5) { return operation; }
        const pending = requests.get(md5) || new Set<Promise<unknown>>();
        requests.set(md5, pending);
        const tracked = operation.finally(() => {
            pending.delete(tracked);
            if (!pending.size && requests.get(md5) === pending) { requests.delete(md5); }
        });
        pending.add(tracked);
        return tracked;
    };
    async function settleRequests(md5: string): Promise<void> {
        // Finishing a render can enqueue its next query. Drain those continuations
        // before disconnecting the analysis session beneath a closing editor.
        do {
            await Promise.allSettled([...(requests.get(md5) || [])]);
            await new Promise<void>(resolve => setImmediate(resolve));
        } while (requests.get(md5)?.size);
    }
    const context = new ProgramContext(call, extension.globalState);
    const tracker = new AnalysisTracker();
    const sessionsView = new SessionsView(call, context, tracker);
    const sessionsTree = vscode.window.createTreeView('ghidra.sessions', { treeDataProvider: sessionsView });
    sessionsView.bind(sessionsTree);
    const stringFiles = new StringFiles(call, context, () => references);
    const stringsView = new StringsView(call, context, stringFiles);
    const browser = new ProgramBrowser(call, context, md5 => stringsView.refresh(md5));
    let listingViews: ListingViews | undefined;
    const workbench = new Workbench(call, context, editor => listingViews?.addressAt(editor) || memoryAddressAt(editor));
    const typeFiles = new DataTypeFiles(call, context, extension.workspaceState);
    const editing = new EditingUI(call, context, typeFiles);
    const typeEditorView = new DataTypeEditorView(call);
    extension.subscriptions.push(context, tracker, stringFiles, stringsView, sessionsView, sessionsTree, browser, workbench, editing, typeFiles, typeEditorView);
    const memory = new GhidraMemory(call);
    renames = new ReadonlyRenames(call, async md5 => { await Promise.all([browser.refresh(md5), workbench.refresh(md5)]); });
    // Template display is presentation-only: re-render the names already on screen for the current program.
    extension.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        if (!event.affectsConfiguration('ghidraLsp.templateArguments')) { return; }
        const value = vscode.workspace.getConfiguration('ghidraLsp').get<string>('templateArguments', 'omit');
        setShowTemplateArguments(value === 'show');
        try {
            await call('ghidra.configure', { templateArguments: value });
            const md5 = context.current;
            if (md5) { await Promise.all([browser.refresh(md5), workbench.refresh(md5)]); }
        } catch (error) { log(`Template display: ${String(error)}`); }
    }));
    extension.subscriptions.push(memory, renames, vscode.workspace.registerFileSystemProvider('ghidra', memory, { isCaseSensitive: true, isReadonly: true }));
    const byteFiles = new MemoryFiles(call, context);
    const listingFiles = new ListingFiles(call, context, byteFiles, extension.workspaceState);
    listingViews = new ListingViews(call, listingFiles);
    const graphView = new ControlFlowView(listingFiles, workbench, context);
    extension.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        if (!event.affectsConfiguration('ghidraLsp.views.singleKeyShortcuts')) { return; }
        const enabled = singleKeyShortcutsEnabled();
        await Promise.all([workbench.setSingleKeyShortcuts(enabled), graphView.setSingleKeyShortcuts(enabled)]);
    }));
    const viewSets = new ViewSets(call, context, listingViews, graphView);
    const labels = new DocumentLabels(call, context, uri => {
        return uri.scheme === listingScheme ? listingFiles.entry(uri)?.window.name : undefined;
    }, uri => uri.scheme === listingScheme ? listingFiles.mode(uri) : 'bytes');
    extension.subscriptions.push(listingFiles, listingViews, byteFiles, graphView, viewSets, labels,
        vscode.workspace.registerFileSystemProvider(listingScheme, listingFiles, { isCaseSensitive: true, isReadonly: true }),
        vscode.workspace.registerFileSystemProvider(memoryScheme, byteFiles, { isCaseSensitive: true, isReadonly: true }),
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.scheme === memoryScheme && document.languageId !== 'ghidra-memory') {
                void Promise.resolve(vscode.languages.setTextDocumentLanguage(document, 'ghidra-memory')).catch(log);
            }
        }));
    const languages = new Map<string, Promise<vscode.TextDocument>>();
    const ensureLanguage = (document: vscode.TextDocument): Promise<vscode.TextDocument> => {
        const key = document.uri.toString();
        const pending = languages.get(key);
        if (pending) { return pending; }
        if (document.uri.path.endsWith('.md')) { return Promise.resolve(document); }
        if (document.languageId === 'ghidra-decompiled') { return Promise.resolve(document); }
        const change = Promise.resolve(vscode.languages.setTextDocumentLanguage(document, 'ghidra-decompiled'))
            .finally(() => languages.delete(key));
        languages.set(key, change);
        return change;
    };
    extension.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        if (document.uri.scheme === 'ghidra') { void ensureLanguage(document).catch(log); }
    }));
    references = new ReferenceViews(call, labels, context, ensureLanguage);
    extension.subscriptions.push(references);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    status.name = 'Ghidra active program';
    status.command = 'ghidraLsp.programOverview';
    status.tooltip = 'Open Ghidra program overview';
    const analysisStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    analysisStatus.name = 'Ghidra analysis progress';
    analysisStatus.command = 'ghidra.sessions.focus';
    analysisStatus.tooltip = 'Show Ghidra analysis progress in Sessions';
    extension.subscriptions.push(tracker.onDidChange(() => {
        const tasks = tracker.active;
        void vscode.commands.executeCommand('setContext', 'ghidra.hasWaitingAnalysis', tasks.some(task => task.cancellable));
        if (!tasks.length) { analysisStatus.hide(); return; }
        const task = tasks[tasks.length - 1];
        const stage = task.stage === 'import' ? (task.background ? 'Background import' : 'Importing') : (task.background ? 'Background analysis' : 'Analyzing');
        const percentage = typeof task.percentage === 'number' ? ` ${Math.round(task.percentage)}%` : '';
        const detail = task.detail ? ` · ${inlineText(task.detail, 28)}` : '';
        analysisStatus.text = tasks.length > 1 ? `$(sync~spin) Ghidra: ${countLabel(tasks.length, 'analysis task')}`
            : `$(sync~spin) Ghidra: ${task.name} · ${stage}${percentage}${detail}`;
        analysisStatus.tooltip = tasks.length > 1
            ? `${countLabel(tasks.length, 'analysis task')}\nClick to focus Ghidra Sessions.`
            : `${task.name} · ${stage}${percentage}${task.detail ? ` · ${task.detail}` : ''}\nClick to focus Ghidra Sessions.`;
        analysisStatus.accessibilityInformation = statusAccessibility(analysisStatus.text, 'Show Ghidra Sessions');
        analysisStatus.show();
    }));
    const programVersions = new Map<string, string>();
    const updateStatus = (): void => {
        const md5 = context.current;
        if (!md5) { status.hide(); return; }
        const uri = vscode.window.activeTextEditor?.document.uri;
        const entry = uri?.scheme === 'ghidra' && uri.authority.toLowerCase() === md5 ? displayAddress(decodeURIComponent(uri.path.split('/').pop() || '')) : '';
        const address = listingViews.addressAt(vscode.window.activeTextEditor);
        status.text = `$(file-binary) ${context.name(md5)}${entry ? ` · ${entry}` : ''}${address ? ` · ${plainAddress(address)}` : ''}`;
        status.accessibilityInformation = statusAccessibility(status.text, 'Open Ghidra program overview');
        status.show();
    };
    function log(error: unknown): void { output.appendLine(String(error)); }
    extension.subscriptions.push(status, analysisStatus, context.onDidChange(md5 => {
        if (md5 && !context.isClosing(md5)) { memory.reopen(md5); }
        updateStatus();
    }), vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && ['ghidra', listingScheme, memoryScheme, typeScheme, 'ghidra-type-current', stringScheme, referenceScheme].includes(editor.document.uri.scheme)) { void context.activate(editor.document.uri.authority).catch(log); }
        updateStatus();
    }));
    /** The address a listing should open at, and the function it belongs to. */
    const listingTarget = async (md5: string, resource?: unknown): Promise<{ address: string; entry?: string } | undefined> => {
        if (resource && typeof resource === 'object' && 'address' in resource) {
            const address = (resource as { address?: unknown }).address;
            const entry = (resource as { entry?: unknown }).entry;
            if (typeof address === 'string' && address) {
                return { address, entry: typeof entry === 'string' && entry ? entry : undefined };
            }
        }
        const uri = resource instanceof vscode.Uri ? resource : undefined;
        const editor = vscode.window.activeTextEditor;
        const entry = editor && editor.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5
            && editor.document.uri.path.startsWith('/function/')
            ? decodeURIComponent(editor.document.uri.path.slice('/function/'.length)) : undefined;
        const location = await cursorLocation(call, md5, uri);
        if (location?.address) { return { address: location.code_unit_address || location.address, entry }; }
        const typed = await vscode.window.showInputBox({ title: 'Listing address', prompt: `Address in ${context.name(md5)}`, ignoreFocusOut: true });
        return typed?.trim() ? { address: typed.trim() } : undefined;
    };
    const show = async (entry: string, md5: string): Promise<void> => {
        const result = await call<{ uri: string }>('ghidra.openFunction', { entry, md5 });
        let document = await vscode.workspace.openTextDocument(vscode.Uri.parse(result.uri));
        document = await ensureLanguage(document);
        await vscode.window.showTextDocument(document, { preview: false });
        await context.activate(md5);
        updateStatus();
    };
    const register = (name: string, action: (resource?: unknown, extra?: unknown) => Promise<void>): void => {
        extension.subscriptions.push(vscode.commands.registerCommand(`ghidraLsp.${name}`, async (resource?: unknown, extra?: unknown) => {
            try { await action(resource, extra); } catch (error) { log(error); void vscode.window.showErrorMessage(formatFriendlyError(error)); }
        }));
    };
    let activeJobCounter = 0;
    async function analysis<T>(
        title: string,
        name: string,
        action: (report: (op: AnalysisOperation) => void) => Promise<T>,
        completed: (result: T) => Promise<void>,
        stage = 'import',
        md5?: string,
    ): Promise<void> {
        let task: Promise<T> | undefined;
        let stopped = false;
        const taskId = `task-${++activeJobCounter}-${Date.now()}`;
        const startTime = Date.now();
        const result = await vscode.window.withProgress<T | undefined>({
            location: vscode.ProgressLocation.Notification,
            title: `Ghidra: ${title}`,
            cancellable: true,
        }, async (progress, token) => {
            let stopWaiting!: () => void;
            const cancelled = new Promise<undefined>(resolve => {
                stopWaiting = () => {
                    if (stopped) { return; }
                    stopped = true;
                    tracker.update(taskId, { background: true, cancellable: false });
                    resolve(undefined);
                };
            });
            tracker.start({ token: taskId, name, md5, stage, startTime, cancellable: true, cancel: stopWaiting });
            const listener = token.onCancellationRequested(stopWaiting);
            if (token.isCancellationRequested) { stopWaiting(); }
            task = Promise.resolve().then(() => action(op => {
                tracker.update(taskId, { md5: op.md5, stage: op.stage || stage, detail: op.detail, percentage: op.percentage });
                if (!stopped) {
                    const stageText = op.stage === 'import' ? 'Importing binary' : 'Analyzing';
                    const dt = op.detail ? ` · ${op.detail}` : '';
                    const pct = typeof op.percentage === 'number' ? ` [${Math.round(op.percentage)}%]` : '';
                    progress.report({ message: `${stageText}${pct}${dt} (cancel to continue in background)` });
                }
            })).finally(() => {
                tracker.finish(taskId);
                sessionsView.refresh();
            });
            try {
                return await Promise.race([task, cancelled]);
            } finally {
                listener.dispose();
            }
        });
        if (!stopped) {
            await completed(result!);
            return;
        }

        void vscode.window.showInformationMessage(
            `Analysis of ${name} continues in the background.`,
            'Show Sessions',
        ).then(sel => {
            if (sel === 'Show Sessions') {
                void vscode.commands.executeCommand('workbench.view.extension.ghidra');
            }
        });

        void task!.then(async value => {
            log(`${title}: background analysis completed`);
            sessionsView.refresh();
            void vscode.window.showInformationMessage(
                `${title}: complete.`,
                'Show program',
            ).then(sel => {
                if (sel === 'Show program' && value && typeof value === 'object' && 'md5' in value && typeof value.md5 === 'string') {
                    const targetMd5 = String(value.md5);
                    void browser.open(targetMd5, name).catch(log);
                }
            });
        }).catch(error => {
            log(error);
            sessionsView.refresh();
            void vscode.window.showErrorMessage(`${title}: ${formatFriendlyError(error)}`);
        });
    }

    async function pollAnalysis(operation: AnalysisOperation, report: (op: AnalysisOperation) => void): Promise<AnalysisOperation> {
        while (operation.state === 'pending') {
            report(operation);
            await new Promise<void>(resolve => setTimeout(resolve, 500));
            operation = await call<AnalysisOperation>('ghidra.pollOpenBinary', { token: operation.token });
        }
        if (operation.state === 'failed') { throw new Error(operation.error || 'Ghidra analysis failed'); }
        report(operation);
        return operation;
    }

    const analysisPrompts = new Map<string, object>();
    async function openProgram(
        target: OpenProgramRequest,
        name: string,
        originalPath?: string,
        allowCandidatePrompt = false,
    ): Promise<void> {
        let session: AnalysisOperation;
        try {
            session = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window, title: `Ghidra: Opening ${name}`,
            }, async () => {
                const operation = await call<AnalysisOperation>('ghidra.beginOpenBinary', target);
                sessionsView.refresh();
                return pollAnalysis(operation, () => {});
            });
        } catch (error) {
            const candidates = allowCandidatePrompt && !target.programName ? extractCandidatePrograms(error) : undefined;
            if (!candidates) { throw error; }
            const chosen = await vscode.window.showQuickPick(candidates, {
                title: 'Select Ghidra Program',
                placeHolder: `Multiple programs exist in ${name}`,
            });
            if (!chosen) { throw error; }
            const nextName = originalPath ? formatOpenDisplayName(originalPath, chosen) : `${name} (${chosen})`;
            await openProgram({ ...target, programName: chosen }, nextName, originalPath, false);
            return;
        }
        await context.remember(session.md5, name, originalPath);
        await context.activate(session.md5, name, originalPath);
        await browser.open(session.md5, name);
        sessionsView.refresh();
        if (session.analyzed || session.analysisRunning || analysisPrompts.has(session.md5)) { return; }
        const prompt = {};
        analysisPrompts.set(session.md5, prompt);
        try {
            const choice = await vscode.window.showInformationMessage(
                `${name} has not been analyzed. Analyze it now?`, 'Analyze', 'Open without analysis');
            if (choice !== 'Analyze' || context.isClosing(session.md5) || analysisPrompts.get(session.md5) !== prompt) { return; }
            const state = await call<{ analyzed: boolean; status: string }>('ghidra.query', {
                md5: session.md5, domain: 'analysis', operation: 'get', params: {},
            });
            if (state.analyzed || ['completed', 'running'].includes(state.status)
                || context.isClosing(session.md5) || analysisPrompts.get(session.md5) !== prompt) { return; }
            await runAnalysis(session.md5, name, false);
        } finally {
            if (analysisPrompts.get(session.md5) === prompt) { analysisPrompts.delete(session.md5); }
        }
    }

    async function runAnalysis(md5: string, name: string, repeat: boolean): Promise<void> {
        await analysis(`${repeat ? 'Reanalyzing' : 'Analyzing'} ${name}`, name,
            async report => pollAnalysis(await call<AnalysisOperation>('ghidra.beginReanalyze', { md5 }), report),
            async () => { await browser.refresh(md5); await workbench.refresh(md5); sessionsView.refresh(); }, 'analysis', md5);
    }
    register('selectSession', async () => {
        const { sessions } = await call<{ sessions: SessionInfo[] }>('ghidra.sessions');
        const choice = await vscode.window.showQuickPick(sessions.filter(s => s.status === 'ready').map(s => ({
            label: context.name(s.md5) !== s.md5 ? context.name(s.md5) : s.fileName || s.name || s.md5,
            description: s.md5, md5: s.md5,
        })), { placeHolder: 'Select a ready Ghidra session' });
        if (choice) { await context.activate(choice.md5, choice.label); await browser.open(choice.md5, choice.label); }
    });
    register('openBinary', async (resource, extra) => {
        const resolved = await resolveOpenInput(resource, extra, false);
        if (resolved) { await openProgram(resolved.target, resolved.name, resolved.originalPath, resolved.interactive); }
    });
    register('openBinaryWithOptions', async (resource, extra) => {
        const resolved = await resolveOpenInput(resource, extra, true);
        if (resolved) { await openProgram(resolved.target, resolved.name, resolved.originalPath, true); }
    });
    register('openRecent', async resource => {
        const requested = resource ? context.recent.find(program => program.md5 === context.resolve(resource)) : undefined;
        const selected = requested ? { program: requested } : await vscode.window.showQuickPick(context.recent.map(program => ({ label: program.name, description: program.path || program.md5, program })), { placeHolder: 'Open a recent Ghidra program' });
        if (!selected) { return; }
        await openRecentProgram(selected.program.md5);
    });
    async function openRecentProgram(md5: string): Promise<void> {
        const program = context.recent.find(item => item.md5.toLowerCase() === md5.toLowerCase());
        const { sessions } = await call<{ sessions: SessionInfo[] }>('ghidra.sessions');
        const session = sessions.find(item => item.md5.toLowerCase() === md5.toLowerCase());
        if (session?.status === 'ready') {
            await browser.open(session.md5, program?.name || session.fileName || session.name || md5);
            sessionsView.refresh();
        } else if (session && isOpenSession(session) && !['stale', 'disconnected'].includes(session.status)) {
            throw new Error('This program is still being analyzed. Check Sessions and select it when ready.');
        } else {
            await openProgram({ md5: md5.toLowerCase() }, program?.name || session?.fileName || session?.name || md5, program?.path);
        }
    }
    register('programOverview', async resource => {
        const md5 = context.require(resource);
        await browser.open(md5, context.name(md5));
    });
    register('openFunction', async resource => {
        const md5 = context.require(resource);
        const { items } = await call<{ items: FunctionInfo[] }>('ghidra.functions', { md5 });
        const selected = await vscode.window.showQuickPick(items.map(f => ({ label: symbolName(f), description: `${f.namespace || ''} ${f.entry}`, detail: f.demangled_name ? f.name : undefined, entry: f.entry })), { matchOnDescription: true, matchOnDetail: true, placeHolder: `Open a function in ${context.name(md5)}` });
        if (selected) { await show(selected.entry, md5); }
    });
    register('refresh', async resource => {
        const md5 = context.require(resource);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Refreshing ${context.name(md5)}` }, async () => {
            await call('ghidra.refresh', { md5 });
            listingFiles.refresh(md5);
            byteFiles.refresh(md5);
            await typeFiles.refresh(md5);
            await renames.refresh(md5);
            await browser.refresh(md5);
            await workbench.refresh(md5);
            await graphView.refresh(md5);
        });
    });
    register('discardRename', async resource => {
        const md5 = context.require(resource);
        try { await call('ghidra.discardRename', { md5 }); }
        finally { await renames.refresh(md5); }
        await browser.refresh(md5);
    });
    register('closeSession', async resource => {
        const md5 = context.require(resource);
        await renames.assertClean(md5);
        await typeFiles.closeEditors(md5);
        context.beginClosing(md5);
        analysisPrompts.delete(md5);
        try {
            // Finish refreshes and saves already in flight while the session and
            // file provider are available, then prevent new reads from racing close.
            await settleRequests(md5);
            await renames.assertClean(md5);
            memory.beginClosing(md5);
            listingFiles.invalidate(md5);
            byteFiles.invalidate(md5);
            browser.close(md5);
            workbench.close(md5);
            graphView.close(md5);
            editing.close(md5);
            for (const group of vscode.window.tabGroups.all) {
                const owns = (uri: vscode.Uri): boolean => ['ghidra', referenceScheme, listingScheme, memoryScheme, typeScheme, 'ghidra-type-current', stringScheme].includes(uri.scheme) && uri.authority.toLowerCase() === md5.toLowerCase();
                const tabs = group.tabs.filter(tab => (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) ? owns(tab.input.uri)
                    : tab.input instanceof vscode.TabInputTextDiff && (owns(tab.input.original) || owns(tab.input.modified)));
                if (tabs.length && !await vscode.window.tabGroups.close(tabs)) { throw new Error('Closing the program was cancelled; its analysis session is still open'); }
            }
            await settleRequests(md5);
            await call('ghidra.closeSession', { md5 });
            memory.close(md5);
            references.close(md5);
            stringFiles.close(md5);
            typeFiles.close(md5);
            programVersions.delete(md5.toLowerCase());
            await context.closed(md5);
            sessionsView.refresh();
        } catch (error) {
            memory.reopen(md5);
            throw new Error(`${String(error)}. Use Ghidra: Select Session or Open Recent to reopen the program.`);
        } finally {
            context.endClosing(md5);
        }
    });
    register('reanalyze', async resource => {
        const md5 = context.require(resource);
        await runAnalysis(md5, context.name(md5), true);
    });
    register('demangle', async resource => {
        const md5 = context.require(resource);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Demangle C++ symbols · ${context.name(md5)}` }, async () => {
            const response = await call<{ result: { renamed: number; failed: number; failures: string[] } }>('ghidra.mutate', { md5, domain: 'symbol', operation: 'demangle', params: {} });
            await browser.refresh(md5); await workbench.refresh(md5); sessionsView.refresh();
            const result = response.result;
            if (result.failed) {
                void vscode.window.showWarningMessage(`Demangled ${result.renamed} symbols; ${result.failed} could not be demangled. ${result.failures.join('; ')}`);
            } else { void vscode.window.showInformationMessage(`Demangled ${result.renamed} C++ symbols.`); }
        });
    });
    register('cancelAnalysis', async resource => {
        const token = resource && typeof resource === 'object' ? (resource as { task?: { token?: string } }).task?.token : undefined;
        const tasks = tracker.active.filter(task => task.cancellable && (!token || task.token === token));
        if (!tasks.length) { void vscode.window.showInformationMessage('No analysis tasks are being awaited.'); return; }
        for (const task of tasks) { task.cancel?.(); }
    });
    register('selectSessionItem', async (resource, extra) => {
        let md5: string | undefined;
        let name: string | undefined;
        if (typeof resource === 'string') {
            md5 = resource;
            name = typeof extra === 'string' ? extra : context.name(resource);
        } else if (resource && typeof resource === 'object' && 'md5' in resource && typeof resource.md5 === 'string') {
            md5 = resource.md5;
            name = context.name(resource.md5);
        }
        if (!md5) { return; }
        const label = name || context.name(md5);
        await context.activate(md5, label);
        await browser.open(md5, label);
        sessionsView.refresh();
    });
    register('openRecentItem', async resource => {
        let md5: string | undefined;
        if (typeof resource === 'string') {
            md5 = resource;
        } else if (resource && typeof resource === 'object' && 'md5' in resource && typeof resource.md5 === 'string') {
            md5 = resource.md5;
        }
        if (!md5) { return; }
        await openRecentProgram(md5);
    });
    register('refreshSessions', async () => {
        sessionsView.refresh();
        const md5 = context.current;
        if (md5) {
            await browser.refresh(md5);
        }
    });
    register('showListing', async (resource, extra) => {
        const md5 = context.require(resource);
        const target = typeof extra === 'string' && extra
            ? { address: extra }
            : await listingTarget(md5, resource);
        if (!target) { return; }
        await listingViews.open(md5, target.address, target.entry);
    });
    register('openViews', async (resource, extra) => {
        const md5 = context.require(resource);
        const editor = vscode.window.activeTextEditor;
        const entry = typeof extra === 'string' && extra ? extra
            : editor && editor.document.uri.scheme === 'ghidra' && editor.document.uri.authority === md5
                && editor.document.uri.path.startsWith('/function/')
                ? decodeURIComponent(editor.document.uri.path.slice('/function/'.length)) : undefined;
        if (!entry) { void vscode.window.showInformationMessage('Open a decompiled function before opening its analysis views.'); return; }
        let address = entry;
        const location = await cursorLocation(call, md5, editor?.document.uri);
        if (location?.address) { address = location.code_unit_address || location.address; }
        await viewSets.open(md5, entry, address);
    });
    const editorForResource = (resource?: unknown): vscode.TextEditor | undefined => resource instanceof vscode.Uri
        ? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === resource.toString())
        : vscode.window.activeTextEditor;
    register('listingFunction', async resource => {
        const editor = editorForResource(resource);
        const address = listingViews.addressAt(editor);
        if (!address) { void vscode.window.showInformationMessage('Put the cursor on a listing row first.'); return; }
        await listingViews.openFunction(editor!.document.uri.authority, address);
    });
    register('listingReferences', async resource => {
        const editor = editorForResource(resource);
        const address = listingViews.addressAt(editor);
        if (!address) { void vscode.window.showInformationMessage('Put the cursor on a listing row first.'); return; }
        await vscode.commands.executeCommand('ghidraLsp.showAddressReferences', editor!.document.uri.authority, address);
    });
    register('analysisView', async (resource, requested) => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const uri = resource instanceof vscode.Uri ? resource
            : tab?.input instanceof vscode.TabInputCustom ? tab.input.uri : vscode.window.activeTextEditor?.document.uri;
        if (!uri || uri.scheme !== listingScheme) { throw new Error('Open a Listing, Bytes, or Control Flow analysis view first.'); }
        const current: AnalysisMode = graphView.isOpen(uri) && !editorForResource(uri) ? 'controlFlow' : listingFiles.mode(uri);
        const options: { label: string; mode: AnalysisMode; description?: string }[] = [
            { label: 'Listing', mode: 'listing' }, { label: 'Bytes', mode: 'bytes' }, { label: 'Control Flow', mode: 'controlFlow' },
        ];
        const selected = typeof requested === 'string' ? options.find(option => option.mode === requested)
            : await vscode.window.showQuickPick(options.map(option => ({ ...option, description: option.mode === current ? 'Current view' : undefined })),
                { title: 'Analysis view', placeHolder: 'Choose a view for this tab' });
        if (selected) { await viewSets.changeView(uri, selected.mode); }
    });
    register('listingBytes', async resource => {
        const editor = editorForResource(resource);
        const address = listingViews.addressAt(editor);
        if (!address) { void vscode.window.showInformationMessage('Put the cursor on a listing row first.'); return; }
        await viewSets.switchTo(editor!, 'bytes', address);
    });
    register('bytesListing', async resource => {
        const editor = editorForResource(resource);
        const address = memoryAddressAt(editor);
        if (!address) { void vscode.window.showInformationMessage('Put the cursor on a byte row first.'); return; }
        await viewSets.switchTo(editor!, 'listing', address);
    });
    register('listingCopyAddress', async resource => {
        const editor = editorForResource(resource);
        const address = listingViews.addressAt(editor);
        if (!address) { void vscode.window.showInformationMessage('Put the cursor on a listing row first.'); return; }
        await vscode.env.clipboard.writeText(address);
        vscode.window.setStatusBarMessage(`Copied ${plainAddress(address)}`, 3000);
    });
    register('listingRefresh', async resource => {
        const editor = editorForResource(resource);
        const md5 = editor?.document.uri.scheme === listingScheme ? editor.document.uri.authority : undefined;
        if (!md5) { void vscode.window.showInformationMessage('Open a Ghidra listing first.'); return; }
        listingFiles.refresh(md5);
    });
    register('listingBrowse', async resource => {
        const editor = editorForResource(resource);
        const md5 = editor?.document.uri.scheme === listingScheme ? editor.document.uri.authority : undefined;
        const address = listingViews.addressAt(editor);
        await vscode.commands.executeCommand('ghidraLsp.browseListing', md5, address);
    });
    register('codeActions', showCodeActions);
    register('renameSymbol', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'ghidra' || !editor.document.uri.path.startsWith('/function/')) { return; }
        await vscode.commands.executeCommand('editor.action.rename', [editor.document.uri, {
            lineNumber: editor.selection.active.line + 1, column: editor.selection.active.character + 1,
        }]);
    });
    register('saveRename', async resource => {
        const uri = resource instanceof vscode.Uri ? resource : vscode.window.activeTextEditor?.document.uri;
        if (uri) { await renames.save(uri); }
    });
    register('saveAllRenames', async () => { await renames.saveAll(); });
    register('showPendingRename', async () => { await renames.showPending(); });
    const changed = new Map<string, ReturnType<typeof setTimeout>>();
    const changedSeq = new Map<string, number>();
    const refreshedSeq = new Map<string, number>();
    async function stopLanguageClient(): Promise<void> {
        changedSub?.dispose();
        changedSub = undefined;
        const active = client;
        client = undefined;
        if (active) {
            try { await active.stop(); } catch (error) { log(error); }
        }
    }
    async function startLanguageClient(resolved: ResolvedBinaries): Promise<void> {
        await stopLanguageClient();
        const server: ServerOptions = { command: resolved.serverPath, args: [] };
        const nextClient = new LanguageClient('ghidraLsp', 'Ghidra LSP', server, createClientOptions(resolved.mcpCommand));
        client = nextClient;
        await nextClient.start();
        changedSub = nextClient.onNotification('ghidra/changed', (event: { md5: string }) => {
            if (!event || typeof event.md5 !== 'string') { return; }
            const md5 = event.md5.toLowerCase();
            if (context.isClosing(md5)) { return; }
            const seq = (changedSeq.get(md5) ?? 0) + 1;
            changedSeq.set(md5, seq);
            const previous = changed.get(md5);
            if (previous) { clearTimeout(previous); }
            changed.set(md5, setTimeout(() => {
                changed.delete(md5);
                if (context.isClosing(md5)) { return; }
                memory.refresh(md5);
                labels.refresh(md5);
                references.refresh(md5);
                stringFiles.refresh(md5);
                listingFiles.refresh(md5);
                byteFiles.refresh(md5);
                const skipBrowser = (refreshedSeq.get(md5) ?? -1) >= seq;
                void Promise.all([
                    ...(skipBrowser ? [] : [browser.refresh(md5)]),
                    workbench.refresh(md5),
                    graphView.refresh(md5),
                    renames.refresh(md5),
                ]).catch(log);
            }, 150));
        });
    }
    async function resolveAndStart(): Promise<void> {
        const current = vscode.workspace.getConfiguration('ghidraLsp');
        const resolved = await resolveOrInstallBinaries({
            serverPath: current.get<string>('serverPath', 'ghidra-lsp'),
            mcpCommand: current.get<string>('mcpCommand', 'ghidra-mcp'),
            autoInstall: current.get<boolean>('autoInstall', true),
            output,
        });
        await startLanguageClient(resolved);
    }
    let restoredOnce = false;
    async function restoreWorkspace(): Promise<void> {
        if (restoredOnce) { return; }
        restoredOnce = true;
        try {
            const restored = await context.restore();
            const editor = vscode.window.activeTextEditor;
            if (editor && ['ghidra', listingScheme, memoryScheme, typeScheme, 'ghidra-type-current', stringScheme, referenceScheme].includes(editor.document.uri.scheme)) { await context.activate(editor.document.uri.authority); }
            else if (restored) { updateStatus(); }
            sessionsView.refresh();
        } catch (error) {
            restoredOnce = false;
            log(`Program restore: ${String(error)}`);
        }
    }
    register('installBinaries', async () => {
        await stopLanguageClient();
        await installManagedBinaries(output);
        const current = vscode.workspace.getConfiguration('ghidraLsp');
        const resolved = await resolveOrInstallBinaries({
            serverPath: current.get<string>('serverPath', 'ghidra-lsp'),
            mcpCommand: current.get<string>('mcpCommand', 'ghidra-mcp'),
            autoInstall: false,
            output,
        });
        startup = startLanguageClient(resolved);
        await startup;
        await restoreWorkspace();
        sessionsView.refresh();
        void vscode.window.showInformationMessage('Installed ghidra-lsp and ghidra-mcp.');
    });
    extension.subscriptions.push(browser.onWillRefresh(md5 => {
        refreshedSeq.set(md5, changedSeq.get(md5) ?? 0);
    }), new vscode.Disposable(() => { for (const timer of changed.values()) { clearTimeout(timer); } }));

    let busy = false;
    let last = 0;
    const timer = setInterval(async () => {
        if (!client) { return; }
        const interval = vscode.workspace.getConfiguration('ghidraLsp').get<number>('liveRefreshIntervalMs', 2000);
        if (!interval || busy || Date.now() - last < interval) { return; }
        busy = true;
        last = Date.now();
        try {
            const md5 = context.current;
            let activeUnchanged = false;
            if (md5 && !context.isClosing(md5)) {
                const program = await call<Record<string, unknown>>('ghidra.program', { md5 });
                const version = JSON.stringify([program.modified_at, program.function_count, program.symbol_count]);
                const previous = programVersions.get(md5);
                programVersions.set(md5, version);
                activeUnchanged = program.modified_at !== undefined && previous !== undefined && previous === version;
                if (previous !== version) {
                    await Promise.all([browser.refresh(md5), workbench.refresh(md5)]);
                }
            }
            for (const document of new Set(vscode.window.visibleTextEditors.map(editor => editor.document))) {
                if (document.uri.scheme !== 'ghidra' || document.isClosed || document.isDirty || context.isClosing(document.uri.authority) || !document.uri.path.startsWith('/function/')) { continue; }
                if (activeUnchanged && document.uri.authority.toLowerCase() === md5?.toLowerCase()) { continue; }
                await call<Pick<VirtualDocument, 'uri' | 'text'>>('ghidra.refreshDocument', { uri: document.uri.toString() });
            }
        } catch (error) { log(`Live refresh: ${String(error)}`); }
        finally { busy = false; }
    }, 500);
    extension.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));

    startup = resolveAndStart();
    try {
        await startup;
    } catch (error) {
        startup = undefined;
        log(error);
        void vscode.window.showErrorMessage(formatFriendlyError(error), 'Install Binaries', 'Open Settings').then(choice => {
            if (choice === 'Install Binaries') {
                void vscode.commands.executeCommand('ghidraLsp.installBinaries');
            } else if (choice === 'Open Settings') {
                void vscode.commands.executeCommand('workbench.action.openSettings', 'ghidraLsp');
            }
        });
        return;
    }
    await restoreWorkspace();
}
/** Stop the running `ghidra-lsp` language client when the extension deactivates. */
export async function deactivate(): Promise<void> {
    changedSub?.dispose();
    changedSub = undefined;
    await client?.stop();
    client = undefined;
}
