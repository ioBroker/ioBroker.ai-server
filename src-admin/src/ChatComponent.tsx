import React from 'react';

import {
    Box,
    Checkbox,
    CircularProgress,
    FormControlLabel,
    IconButton,
    MenuItem,
    Paper,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { DeleteSweep as ClearIcon, Refresh as RefreshIcon, Send as SendIcon } from '@mui/icons-material';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n } from '@iobroker/gui-components';

// admin does not load the translations of a custom component by itself
const translations: Record<string, Record<string, string>> = {};
const i18nModules = import.meta.glob('./i18n/*.json', { eager: true }) as Record<
    string,
    { default: Record<string, string> }
>;
for (const [file, module] of Object.entries(i18nModules)) {
    translations[file.split('/').pop()?.replace('.json', '') || 'en'] = module.default;
}
I18n.extendTranslations(translations);

/**
 * Translate a text of this component
 *
 * @param key the English text without the prefix
 * @param args values for the placeholders `%s`
 */
function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(`custom_ai-server_${key}`, ...args);
}

/** A downloaded model, as the command `listModels` returns it */
interface ModelInfo {
    name: string;
    size: number;
    loaded: boolean;
}

/** Duration and tokens of an answer, as the command `chat` returns them */
interface AnswerStats {
    model: string;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    tokensPerSecond?: number;
}

interface ChatEntry {
    role: 'user' | 'assistant' | 'error';
    content: string;
    /** What a thinking model thought before the answer */
    thinking?: string;
    ts: number;
    stats?: AnswerStats;
}

/** Answer of `chatResult`: `done` is false while the model is still working */
interface ChatResultAnswer {
    result?: { done?: boolean } & AnswerStats & { message?: { content?: string; thinking?: string } };
    error?: string;
}

/**
 * The browser drops an answer of `sendTo` after 30 seconds, but a model on a CPU often needs longer.
 * So the chat is started with `chatStart`, and its result is fetched with `chatResult`, each waiting this long.
 */
const RESULT_WAIT_MS = 20_000;
/** Give up after this many fetches in a row that got no answer at all */
const MAX_MISSES = 3;

/** The conversation of an instance. It lives outside the component, so it survives switching the tabs. */
interface Session {
    entries: ChatEntry[];
    model: string;
    system: string;
    think: boolean;
    /** The request that is running, if any */
    pending: Promise<void> | null;
}

const sessions: Record<string, Session> = {};

interface ChatState extends ConfigGenericState {
    entries: ChatEntry[];
    models: ModelInfo[] | null;
    model: string;
    system: string;
    think: boolean;
    input: string;
    sending: boolean;
    alive: boolean;
    /** Timestamps of the answers whose thinking is shown */
    shownThinking: number[];
}

function formatSize(bytes: number): string {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * The tab "Chat": a conversation with a downloaded model via the command `chat`, to try the models.
 * Every request sends the whole conversation, so the model knows what was said before.
 */
export default class ChatComponent extends ConfigGeneric<ConfigGenericProps, ChatState> {
    private scrollRef = React.createRef<HTMLDivElement>();
    private aliveId = '';
    private mounted = false;

    constructor(props: ConfigGenericProps) {
        super(props);
        const session = this.session;
        this.state = {
            ...this.state,
            entries: [...session.entries],
            models: null,
            model: session.model,
            system: session.system,
            think: session.think,
            input: '',
            sending: !!session.pending,
            alive: false,
            shownThinking: [],
        };
    }

    private get instanceId(): string {
        return `${this.props.oContext.adapterName}.${this.props.oContext.instance}`;
    }

    private get session(): Session {
        sessions[this.instanceId] ||= { entries: [], model: '', system: '', think: false, pending: null };
        return sessions[this.instanceId];
    }

    async componentDidMount(): Promise<void> {
        await super.componentDidMount();
        this.mounted = true;
        this.aliveId = `system.adapter.${this.instanceId}.alive`;
        const alive = await this.props.oContext.socket
            .getState(this.aliveId)
            .then(state => !!state?.val)
            .catch(() => false);
        this.setState({ alive }, () => this.scrollToBottom());
        if (alive) {
            void this.loadModels();
        }
        await this.props.oContext.socket.subscribeState(this.aliveId, this.onAliveChange);

        // a request that was sent before the tab was left
        const pending = this.session.pending;
        if (pending) {
            void pending.then(() => this.syncWithSession());
        }
    }

    componentWillUnmount(): void {
        this.mounted = false;
        if (this.aliveId) {
            this.props.oContext.socket.unsubscribeState(this.aliveId, this.onAliveChange);
        }
        super.componentWillUnmount?.();
    }

    private onAliveChange = (_id: string, state: ioBroker.State | null | undefined): void => {
        const alive = !!state?.val;
        if (alive !== this.state.alive) {
            this.setState({ alive });
            if (alive) {
                void this.loadModels();
            }
        }
    };

    /** Read the downloaded models and keep the chosen one, else take the default model */
    private async loadModels(): Promise<void> {
        let models: ModelInfo[] = [];
        try {
            const answer = (await this.props.oContext.socket.sendTo(this.instanceId, 'listModels', {})) as
                | { result?: ModelInfo[] }
                | undefined;
            models = answer?.result || [];
        } catch {
            // the instance does not answer, the list stays empty
        }
        const names = models.map(model => model.name);
        const defaultModel = typeof this.props.data?.defaultModel === 'string' ? this.props.data.defaultModel : '';
        let model = this.state.model;
        if (!names.includes(model)) {
            model = names.includes(defaultModel) ? defaultModel : names[0] || '';
        }
        this.session.model = model;
        if (this.mounted) {
            this.setState({ models, model });
        }
    }

    private syncWithSession(): void {
        if (this.mounted) {
            this.setState(
                { entries: [...this.session.entries], sending: !!this.session.pending },
                () => this.scrollToBottom(),
            );
        }
    }

    private scrollToBottom(): void {
        const element = this.scrollRef.current;
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }

    /**
     * Send a command to the instance
     *
     * @param command the command
     * @param message its message
     * @returns the answer, or undefined if none came, e.g. the browser gave up waiting ("timeout")
     */
    private async command<T>(command: string, message: Record<string, unknown>): Promise<T | undefined> {
        const answer: unknown = await this.props.oContext.socket.sendTo(this.instanceId, command, message);
        return answer && typeof answer === 'object' ? (answer as T) : undefined;
    }

    /**
     * Ask the model. The answer is written into the session, also if the tab was left meanwhile.
     *
     * @param session the conversation
     * @param request the message for the command `chat`
     */
    private async ask(session: Session, request: Record<string, unknown>): Promise<void> {
        try {
            const started = await this.command<{ result?: { id?: string }; error?: string }>('chatStart', request);
            const id = started?.result?.id;
            if (!id) {
                throw new Error(started?.error || t('No answer from the instance'));
            }
            let misses = 0;
            for (;;) {
                const answer = await this.command<ChatResultAnswer>('chatResult', { id, wait: RESULT_WAIT_MS });
                if (answer?.error) {
                    throw new Error(answer.error);
                }
                if (answer?.result?.done) {
                    const { message, done: _done, ...stats } = answer.result;
                    session.entries.push({
                        role: 'assistant',
                        content: message?.content || '',
                        thinking: message?.thinking || undefined,
                        ts: Date.now(),
                        stats,
                    });
                    return;
                }
                misses = answer ? 0 : misses + 1;
                if (misses >= MAX_MISSES) {
                    throw new Error(t('No answer from the instance'));
                }
            }
        } catch (error) {
            session.entries.push({ role: 'error', content: (error as Error).message, ts: Date.now() });
        }
    }

    private async send(): Promise<void> {
        const text = this.state.input.trim();
        const session = this.session;
        if (!text || session.pending || !this.state.alive || !this.state.model) {
            return;
        }
        // the model sees the whole conversation, but not the errors
        const messages = session.entries
            .filter(entry => entry.role !== 'error')
            .map(entry => ({ role: entry.role, content: entry.content }));
        messages.push({ role: 'user', content: text });
        session.entries.push({ role: 'user', content: text, ts: Date.now() });

        const request = {
            model: this.state.model,
            messages,
            ...(this.state.system.trim() ? { system: this.state.system.trim() } : {}),
            think: this.state.think,
        };
        session.pending = this.ask(session, request).finally(() => {
            session.pending = null;
        });
        this.setState({ input: '' });
        this.syncWithSession();
        await session.pending;
        this.syncWithSession();
    }

    private clear(): void {
        this.session.entries = [];
        this.setState({ entries: [], shownThinking: [] });
    }

    private onKeyDown = (event: React.KeyboardEvent): void => {
        // Enter sends, Shift+Enter starts a new line
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void this.send();
        }
    };

    private toggleThinking(ts: number): void {
        const shown = this.state.shownThinking;
        this.setState({ shownThinking: shown.includes(ts) ? shown.filter(item => item !== ts) : [...shown, ts] });
    }

    private renderStats(stats: AnswerStats): React.JSX.Element {
        const parts = [
            stats.model,
            `${(stats.durationMs / 1000).toFixed(1)} s`,
            t('%s tokens', stats.completionTokens),
        ];
        if (stats.tokensPerSecond) {
            parts.push(t('%s tokens/s', stats.tokensPerSecond));
        }
        return (
            <Tooltip title={t('Prompt: %s tokens', stats.promptTokens)}>
                <Typography
                    variant="caption"
                    component="div"
                    sx={{ opacity: 0.6, fontSize: '0.7rem' }}
                >
                    {parts.join(' · ')}
                </Typography>
            </Tooltip>
        );
    }

    private renderEntry(entry: ChatEntry): React.JSX.Element {
        const dark = this.props.oContext.themeType === 'dark';
        const isUser = entry.role === 'user';
        let background = dark ? '#3a3a3a' : '#eceff1';
        let color = dark ? '#eee' : '#111';
        if (isUser) {
            background = dark ? '#1e88e5' : '#2196f3';
            color = '#fff';
        } else if (entry.role === 'error') {
            background = dark ? '#5d1f1f' : '#f8d7da';
            color = dark ? '#ffb4b4' : '#842029';
        }
        const thinkingShown = this.state.shownThinking.includes(entry.ts);

        return (
            <Box
                key={entry.ts}
                sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', mb: 1 }}
            >
                <Paper
                    elevation={1}
                    sx={{
                        px: 1.5,
                        py: 1,
                        maxWidth: '75%',
                        background,
                        color,
                        borderRadius: 2,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
                    {entry.thinking ? (
                        <Typography
                            variant="caption"
                            component="div"
                            onClick={() => this.toggleThinking(entry.ts)}
                            sx={{ opacity: 0.7, cursor: 'pointer', fontStyle: 'italic', mb: 0.5 }}
                        >
                            {thinkingShown ? `▾ ${t('Thinking')}\n${entry.thinking.trim()}` : `▸ ${t('Thinking')}`}
                        </Typography>
                    ) : null}
                    <Typography
                        variant="body2"
                        component="div"
                    >
                        {entry.content}
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 0.25 }}>
                        {entry.stats ? this.renderStats(entry.stats) : null}
                        <Typography
                            variant="caption"
                            component="div"
                            sx={{ opacity: 0.6, fontSize: '0.7rem' }}
                        >
                            {new Date(entry.ts).toLocaleTimeString()}
                        </Typography>
                    </Box>
                </Paper>
            </Box>
        );
    }

    private renderHint(): React.JSX.Element | null {
        let text = '';
        if (!this.state.alive) {
            text = t('Start the instance to chat.');
        } else if (this.state.models && !this.state.models.length) {
            text = t('No model downloaded yet. Download one in the tab "Models".');
        }
        return text ? (
            <Typography
                sx={{ p: 1 }}
                color="warning.main"
            >
                {text}
            </Typography>
        ) : null;
    }

    renderItem(): React.JSX.Element {
        const dark = this.props.oContext.themeType === 'dark';
        const { alive, entries, models, model, system, think, input, sending } = this.state;
        const ready = alive && !!model;

        return (
            <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 300px)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                    <Select
                        size="small"
                        variant="standard"
                        value={models?.some(item => item.name === model) ? model : ''}
                        displayEmpty
                        disabled={!alive || !models?.length}
                        onChange={event => {
                            this.session.model = String(event.target.value);
                            this.setState({ model: this.session.model });
                        }}
                        sx={{ minWidth: 220 }}
                    >
                        <MenuItem
                            value=""
                            disabled
                        >
                            {t('Model')}
                        </MenuItem>
                        {(models || []).map(item => (
                            <MenuItem
                                key={item.name}
                                value={item.name}
                            >
                                {item.name}
                                <Typography
                                    component="span"
                                    variant="caption"
                                    sx={{ opacity: 0.6, ml: 1 }}
                                >
                                    {formatSize(item.size)}
                                    {item.loaded ? `, ${t('loaded')}` : ''}
                                </Typography>
                            </MenuItem>
                        ))}
                    </Select>
                    <Tooltip title={t('Reload the list of models')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!alive}
                                onClick={() => void this.loadModels()}
                            >
                                <RefreshIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('Thinking models think first. That takes many times longer.')}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    size="small"
                                    checked={think}
                                    onChange={event => {
                                        this.session.think = event.target.checked;
                                        this.setState({ think: this.session.think });
                                    }}
                                />
                            }
                            label={t('Think before answering')}
                        />
                    </Tooltip>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title={t('Clear the chat')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!entries.length || sending}
                                onClick={() => this.clear()}
                            >
                                <ClearIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
                <TextField
                    size="small"
                    variant="standard"
                    fullWidth
                    label={t('System prompt')}
                    placeholder={t('e.g. Answer briefly.')}
                    value={system}
                    onChange={event => {
                        this.session.system = event.target.value;
                        this.setState({ system: this.session.system });
                    }}
                    sx={{ mb: 1 }}
                />

                {this.renderHint()}

                <Box
                    ref={this.scrollRef}
                    sx={{
                        flex: 1,
                        overflowY: 'auto',
                        p: 1,
                        border: `1px solid ${dark ? '#444' : '#ccc'}`,
                        borderRadius: 1,
                        background: dark ? '#1e1e1e' : '#fafafa',
                        mb: 1,
                    }}
                >
                    {entries.length ? (
                        entries.map(entry => this.renderEntry(entry))
                    ) : (
                        <Typography
                            sx={{ p: 2, textAlign: 'center', opacity: 0.6 }}
                            variant="body2"
                        >
                            {t('No messages yet. The model sees the whole conversation until the chat is cleared.')}
                        </Typography>
                    )}
                    {sending ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, opacity: 0.7 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2">
                                {models?.find(item => item.name === this.state.model)?.loaded
                                    ? t('Waiting for the answer.')
                                    : t('Waiting for the answer. The first one takes longer, as the model is loaded.')}
                            </Typography>
                        </Box>
                    ) : null}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                    <TextField
                        fullWidth
                        multiline
                        maxRows={4}
                        size="small"
                        variant="outlined"
                        placeholder={t('Type a message…')}
                        value={input}
                        disabled={!ready}
                        onChange={event => this.setState({ input: event.target.value })}
                        onKeyDown={this.onKeyDown}
                    />
                    <Tooltip title={t('Send (Enter)')}>
                        <span>
                            <IconButton
                                color="primary"
                                disabled={!ready || sending || !input.trim()}
                                onClick={() => void this.send()}
                            >
                                <SendIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </Box>
        );
    }
}
