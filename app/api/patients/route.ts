import { getPatients, getPatientBundle } from '@/lib/data';

/**
 * 患者列表接口（含用药视图与相互作用）
 * 主要给外部 Agent / MCP 客户端与自动化测试用；页面渲染走服务端组件，直连数据层。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  const patients = await getPatients();

  if (id) {
    const target = patients.find((p) => p.id === id);
    if (!target) return Response.json({ error: '患者不存在' }, { status: 404 });
    return Response.json(await getPatientBundle(target));
  }

  const bundles = await Promise.all(patients.map((p) => getPatientBundle(p)));
  return Response.json({ count: bundles.length, patients: bundles });
}
