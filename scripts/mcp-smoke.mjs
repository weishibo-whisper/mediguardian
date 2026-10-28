#!/usr/bin/env node
/**
 * MCP 集成冒烟测试
 * ==================================================================
 * 用法：先启动 Web 服务（npm run dev 或 npm start），再执行 `node scripts/mcp-smoke.mjs`
 *
 * 用官方 SDK 的 Client + StdioClientTransport 真实拉起 mcp/server.mjs，
 * 走一次完整握手：initialize → tools/list → tools/call，
 * 校验 5 个工具是否全部可用、桥接（/api/mcp）是否连通。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED = ['list_patients', 'check_interaction', 'lab_assess', 'search_kb', 'build_med_plan'];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['mcp/server.mjs'],
  env: { ...process.env, MCP_API_BASE: process.env.MCP_API_BASE || 'http://127.0.0.1:3000' },
  stderr: 'pipe',
});

const client = new Client({ name: 'mediguardian-smoke', version: '1.0.0' }, { capabilities: {} });

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  console.log('\n守药人 MCP 集成冒烟测试\n');
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check('tools/list 返回 5 个工具', names.length === EXPECTED.length, names.join(', '));
  check('工具名与实现一致', EXPECTED.every((n) => names.includes(n)));
  check('每个工具都有 inputSchema', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

  const patients = await client.callTool({ name: 'list_patients', arguments: {} });
  const patientText = patients.content?.[0]?.text ?? '';
  check('list_patients 通过 HTTP 桥返回数据', patientText.includes('p-001') && patientText.includes('count'));

  const interaction = await client.callTool({
    name: 'check_interaction',
    arguments: { patientId: 'p-001' },
  });
  const interactionText = interaction.content?.[0]?.text ?? '';
  check(
    'check_interaction 识别出高风险组合',
    interactionText.includes('high') || interactionText.includes('高风险'),
    interactionText.slice(0, 60).replace(/\s+/g, ' '),
  );

  const kb = await client.callTool({ name: 'search_kb', arguments: { query: '华法林 布洛芬 出血', topK: 3 } });
  const kbText = kb.content?.[0]?.text ?? '';
  check('search_kb 返回证据片段', /kb-[a-z-]+#\d/.test(kbText), (kbText.match(/kb-[a-z-]+#\d/) ?? ['无'])[0]);

  const plan = await client.callTool({ name: 'build_med_plan', arguments: { patientId: 'p-001' } });
  const planText = plan.content?.[0]?.text ?? '';
  check('build_med_plan 返回五段式方案', planText.includes('keep') || planText.includes('保留'), planText.slice(0, 60).replace(/\s+/g, ' '));
} catch (error) {
  console.log(`  ✗ 握手失败：${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
} finally {
  await client.close().catch(() => {});
}

if (failures > 0) {
  console.error(`\n✗ ${failures} 项未通过（Web 服务是否已启动？）\n`);
  process.exit(1);
}
console.log('\n✓ MCP Server 全部检查通过\n');
