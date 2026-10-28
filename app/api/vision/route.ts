import { extractDrugs, findDrug } from '@/lib/data';
import { getLlmConfig, visionExtract } from '@/lib/llm/provider';

/**
 * 多模态入口：药盒 / 处方照片 → 结构化用药清单
 * ------------------------------------------------------------------
 * 双路径：
 *  - 配置了 VISION_MODEL 与 key：调用视觉大模型识别，再由本地药物库做「名称归一化」，
 *    这一步很关键——模型常把「拜阿司匹灵」写成各种变体，必须映射回本库 drugId 才能参与风险计算；
 *  - 未配置：返回演示识别结果，并在响应里显式标注 provider=mock，
 *    UI 会显示「演示模式」标签，绝不伪装成真实识别。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RecognizedItem {
  name: string;
  dose?: string;
  freq?: string;
  matchedDrugId: string | null;
  matchedName: string | null;
  confidence: number;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { image?: string; hint?: string };
  const config = getLlmConfig();

  if (!body.image) {
    return Response.json({ error: '缺少图片数据' }, { status: 400 });
  }

  /* ---------- 演示模式 ---------- */
  if (!config.enabled) {
    const demo: RecognizedItem[] = [
      { name: '华法林钠片', dose: '2.5 mg', freq: '每晚一次', matchedDrugId: 'warfarin', matchedName: '华法林', confidence: 0.94 },
      { name: '芬必得（布洛芬缓释胶囊）', dose: '300 mg', freq: '疼痛时', matchedDrugId: 'ibuprofen', matchedName: '布洛芬', confidence: 0.89 },
    ];
    return Response.json({
      provider: 'mock',
      note: '未配置视觉模型，返回内置演示识别结果；配置 LLM_PROVIDER + LLM_API_KEY 后即为真实识别。',
      raw: '华法林钠片 2.5mg×60片；芬必得 0.3g×20粒',
      items: demo,
    });
  }

  /* ---------- 真实视觉识别 ---------- */
  try {
    const raw = await visionExtract(
      body.image,
      body.hint ?? '这是一位老年患者的药盒或处方，请识别通用名与规格。',
    );
    const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText) as {
      drugs?: Array<{ name?: string; dose?: string; freq?: string; confidence?: number }>;
      raw?: string;
    };

    const items: RecognizedItem[] = [];
    for (const item of parsed.drugs ?? []) {
      const name = (item.name ?? '').trim();
      if (!name) continue;
      const matched = (await findDrug(name)) ?? (await extractDrugs(name))[0] ?? null;
      items.push({
        name,
        dose: item.dose,
        freq: item.freq,
        matchedDrugId: matched ? matched.id : null,
        matchedName: matched ? matched.name : null,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
      });
    }

    return Response.json({
      provider: config.visionModel,
      raw: parsed.raw ?? raw,
      items,
      note: items.some((i) => !i.matchedDrugId)
        ? '部分药品未能匹配本地药物库，需人工确认后再纳入风险评估。'
        : '全部药品已匹配本地药物库，可参与相互作用计算。',
    });
  } catch (error) {
    return Response.json(
      { error: `识别失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 502 },
    );
  }
}
