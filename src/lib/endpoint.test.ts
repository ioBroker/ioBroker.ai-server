import { expect } from 'chai';
import type { NetworkInterfaceInfo } from 'node:os';
import { escapeHtml, getEndpoints, hostAddresses } from './endpoint';

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
    return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null };
}

describe('endpoint', () => {
    describe('hostAddresses', () => {
        it('returns the IPv4 addresses that other hosts reach', () => {
            const ipv6: NetworkInterfaceInfo = {
                address: 'fe80::1',
                netmask: 'ffff:ffff:ffff:ffff::',
                family: 'IPv6',
                mac: '00:00:00:00:00:00',
                internal: false,
                cidr: null,
                scopeid: 2,
            };
            expect(
                hostAddresses({
                    lo: [ipv4('127.0.0.1', true)],
                    eth0: [ipv4('192.168.1.10'), ipv6],
                    wlan0: [ipv4('192.168.1.11')],
                    docker0: [ipv4('172.17.0.1')],
                    'br-0123456789ab': [ipv4('172.18.0.1')],
                }),
            ).to.deep.equal(['192.168.1.10', '192.168.1.11']);
        });
    });

    describe('getEndpoints', () => {
        it('is only local with the default bind address', () => {
            expect(getEndpoints({ backend: 'docker', bind: '127.0.0.1', port: 11434 }, ['192.168.1.10'])).to.deep.equal(
                {
                    urls: ['http://127.0.0.1:11434'],
                    localOnly: true,
                },
            );
            expect(getEndpoints({ backend: 'docker', bind: '', port: '' }, [])).to.deep.equal({
                urls: ['http://127.0.0.1:11434'],
                localOnly: true,
            });
        });

        it('lists the addresses of the host for 0.0.0.0', () => {
            expect(
                getEndpoints({ backend: 'docker', bind: '0.0.0.0', port: '11500' }, ['192.168.1.10', '10.0.0.5']),
            ).to.deep.equal({ urls: ['http://192.168.1.10:11500', 'http://10.0.0.5:11500'], localOnly: false });
            // a host without network
            expect(getEndpoints({ backend: 'docker', bind: '0.0.0.0', port: 11434 }, [])).to.deep.equal({
                urls: ['http://127.0.0.1:11434'],
                localOnly: true,
            });
        });

        it('uses a given bind address', () => {
            expect(getEndpoints({ backend: 'docker', bind: '192.168.1.187', port: 11434 }, [])).to.deep.equal({
                urls: ['http://192.168.1.187:11434'],
                localOnly: false,
            });
            expect(getEndpoints({ backend: 'docker', bind: 'fd00::5', port: 11434 }, [])?.urls).to.deep.equal([
                'http://[fd00::5]:11434',
            ]);
        });

        it('uses the URL of the external server', () => {
            expect(getEndpoints({ backend: 'external', externalUrl: 'http://192.168.1.50:11434/' }, [])).to.deep.equal({
                urls: ['http://192.168.1.50:11434'],
                localOnly: false,
            });
            expect(getEndpoints({ backend: 'external', externalUrl: 'http://localhost:11434' }, [])).to.deep.equal({
                urls: ['http://localhost:11434'],
                localOnly: true,
            });
        });

        it('has no address without a valid URL of the external server', () => {
            expect(getEndpoints({ backend: 'external', externalUrl: '' }, [])).to.equal(null);
            expect(getEndpoints({ backend: 'external', externalUrl: 'ftp://host' }, [])).to.equal(null);
        });
    });

    describe('escapeHtml', () => {
        it('escapes the special characters', () => {
            expect(escapeHtml('<a href="x">\'&\'</a>')).to.equal(
                '&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;',
            );
        });
    });
});
