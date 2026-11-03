/**
 * The addresses under which other adapters and programs reach Ollama, as shown in the instance settings
 */
import type { NetworkInterfaceInfo } from 'node:os';

/** The settings that decide the address, as in the instance settings (possibly not saved yet) */
export interface EndpointSettings {
    /** `docker` or `external` */
    backend?: unknown;
    /** Host address the container port is bound to */
    bind?: unknown;
    /** Host port of the container */
    port?: unknown;
    /** URL of the external server */
    externalUrl?: unknown;
}

/** The addresses of Ollama */
export interface Endpoints {
    /** Base URLs of the Ollama API, e.g. `http://192.168.1.10:11434` */
    urls: string[];
    /** Only programs on the host of the instance reach these addresses */
    localOnly: boolean;
}

/** Interfaces of Docker and virtual machines: their addresses are not reachable from other hosts */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|cni|flannel)/;

/**
 * IPv4 addresses of the host that other hosts can reach
 *
 * @param interfaces the result of `os.networkInterfaces()`
 */
export function hostAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
    return Object.entries(interfaces)
        .filter(([name]) => !VIRTUAL_INTERFACE.test(name))
        .flatMap(([, infos]) => infos || [])
        .filter(info => info.family === 'IPv4' && !info.internal)
        .map(info => info.address);
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function withPort(host: string, port: number): string {
    return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/**
 * The addresses of Ollama for the given settings
 *
 * @param settings backend, bind address, port and URL of the external server
 * @param addresses IPv4 addresses of the host, see {@link hostAddresses}
 * @returns null if the URL of the external server is missing or invalid
 */
export function getEndpoints(settings: EndpointSettings, addresses: string[]): Endpoints | null {
    if (settings.backend === 'external') {
        const url = asText(settings.externalUrl).replace(/\/+$/, '');
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return { urls: [url], localOnly: ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) };
    }
    const port = Number(settings.port) || 11434;
    const bind = asText(settings.bind);
    if (!bind || bind === '127.0.0.1' || bind === 'localhost' || bind === '::1') {
        return { urls: [withPort('127.0.0.1', port)], localOnly: true };
    }
    if (bind === '0.0.0.0' || bind === '::') {
        return addresses.length
            ? { urls: addresses.map(address => withPort(address, port)), localOnly: false }
            : { urls: [withPort('127.0.0.1', port)], localOnly: true };
    }
    return { urls: [withPort(bind, port)], localOnly: false };
}

/**
 * Escape a text for HTML
 *
 * @param text the text
 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}
