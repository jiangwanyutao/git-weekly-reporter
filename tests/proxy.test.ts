// 运行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROXY_URL,
  activeProxy,
  updateCheckRoutes,
  downloadRoutes,
  withRouteFallback,
  migrateProxySettings,
} from '../src/lib/proxy.ts';

test('默认代理地址是 Clash Verge 端口', () => {
  assert.equal(DEFAULT_PROXY_URL, 'http://127.0.0.1:7897');
});

test('开关关闭时不使用代理，即使填了地址', () => {
  assert.equal(activeProxy({ proxyEnabled: false, proxyUrl: 'http://127.0.0.1:1080' }), undefined);
});

test('开关打开时使用地址，缺协议补 http，留空回落默认地址', () => {
  assert.equal(activeProxy({ proxyEnabled: true, proxyUrl: '127.0.0.1:1080' }), 'http://127.0.0.1:1080');
  assert.equal(activeProxy({ proxyEnabled: true, proxyUrl: '  ' }), DEFAULT_PROXY_URL);
});

test('检查更新：关闭代理时先直连，失败再走代理', () => {
  assert.deepEqual(updateCheckRoutes({ proxyEnabled: false, proxyUrl: '' }), [undefined, DEFAULT_PROXY_URL]);
});

test('检查更新：开启代理时先走代理，失败再直连', () => {
  assert.deepEqual(updateCheckRoutes({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:1080' }), ['http://127.0.0.1:1080', undefined]);
});

test('第一条线路成功就不再尝试后面的线路', async () => {
  const tried: (string | undefined)[] = [];
  const result = await withRouteFallback([undefined, 'http://p'], async (proxy) => {
    tried.push(proxy);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.deepEqual(tried, [undefined]);
});

test('第一条线路失败时换下一条线路重试', async () => {
  const tried: (string | undefined)[] = [];
  const result = await withRouteFallback([undefined, 'http://p'], async (proxy) => {
    tried.push(proxy);
    if (!proxy) throw new Error('direct down');
    return `via ${proxy}`;
  });
  assert.equal(result, 'via http://p');
  assert.deepEqual(tried, [undefined, 'http://p']);
});

test('所有线路都失败时，错误信息里带上每条线路的原因', async () => {
  await assert.rejects(
    withRouteFallback([undefined, 'http://p'], async (proxy) => {
      throw new Error(proxy ? 'proxy refused' : 'direct timeout');
    }),
    (err: Error) => /不指定代理.*direct timeout/.test(err.message) && /代理 http:\/\/p.*proxy refused/.test(err.message)
  );
});

test('迁移：老用户填过代理地址，升级后开关自动打开并沿用地址', () => {
  const migrated = migrateProxySettings({ theme: 'dark', notionProxyUrl: '', updaterProxyUrl: 'http://127.0.0.1:1080' });
  assert.deepEqual(migrated, { theme: 'dark', proxyEnabled: true, proxyUrl: 'http://127.0.0.1:1080' });
});

test('迁移：老用户没填过代理，开关关闭并预填默认地址', () => {
  const migrated = migrateProxySettings({ notionProxyUrl: '', updaterProxyUrl: '' });
  assert.deepEqual(migrated, { proxyEnabled: false, proxyUrl: DEFAULT_PROXY_URL });
});

test('迁移：已是新结构时原样保留，并清掉残留的旧字段', () => {
  const migrated = migrateProxySettings({ proxyEnabled: false, proxyUrl: 'http://x:1', notionProxyUrl: 'http://old' });
  assert.deepEqual(migrated, { proxyEnabled: false, proxyUrl: 'http://x:1' });
});

test('下载：先走检测成功的那条线路，失败再换另一条', () => {
  const off = { proxyEnabled: false, proxyUrl: '' };
  assert.deepEqual(downloadRoutes(off, undefined), [undefined, DEFAULT_PROXY_URL]);
});

test('下载：检测是靠代理兜底才成功的，下载直接先走代理，不再先试直连', () => {
  const off = { proxyEnabled: false, proxyUrl: '' };
  assert.deepEqual(downloadRoutes(off, DEFAULT_PROXY_URL), [DEFAULT_PROXY_URL, undefined]);
});

test('下载：开启代理时同样先走代理，再直连', () => {
  const on = { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:1080' };
  assert.deepEqual(downloadRoutes(on, 'http://127.0.0.1:1080'), ['http://127.0.0.1:1080', undefined]);
});
