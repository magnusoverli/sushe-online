const { BlockList, isIP } = require('node:net');

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(String(address), Number(prefix), 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  blocked.addSubnet(String(address), Number(prefix), 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function normalizeHostname(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isPublicAddress(address) {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 4) return !blocked.check(normalized, 'ipv4');
  // Global unicast only: also excludes mapped/compatible IPv4, NAT64, local,
  // link-local, unspecified, multicast and other translation mechanisms.
  return (
    family === 6 &&
    globalV6.check(normalized, 'ipv6') &&
    !blocked.check(normalized, 'ipv6')
  );
}

module.exports = { isPublicAddress, normalizeHostname };
