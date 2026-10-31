import { count,eq } from 'drizzle-orm';
import type { CaseData } from '../contracts/index';
import type { Store } from './db';
import { cases, caseVersions,editorialRecords } from './schema';
import { digest } from './config';

const samples: (CaseData & { id: string })[] = [
  { id: 'sample-game', title: '三关打砖块', prompt: '用单个 HTML 文件做一个可玩的打砖块游戏。包含 3 个关卡、砖块碎裂动画、键盘与触屏双操作，得分存 localStorage。不要引用任何外部资源。', scene: 'game', capabilities: ['long', 'coding'], artifactType: 'web', executionMode: 'html', referenceKind: 'game', inputs: [], reference: null, instructions: '返回完整的单个 HTML 文件。', sample: true },
  { id: 'sample-voxel', title: '体素日式庭院', prompt: '用体素搭一座日式庭院，包含枯山水、石灯笼、枫树和回廊。正交视角，暖灰配色，地面留出完整的砂纹细节。', scene: 'voxel', capabilities: ['vision', 'long'], artifactType: 'image', executionMode: 'harness', referenceKind: 'voxel', inputs: [], reference: null, instructions: '需要配置能生成并渲染三维资产的工具。', sample: true },
  { id: 'sample-landing', title: 'AI 会议纪要落地页', prompt: '为「AI 会议纪要」做一版落地页首屏，包含主标题、副标题、CTA、三条卖点和一张产品示意图。风格克制，不要蓝紫渐变，不要机器人插图。', scene: 'landing', capabilities: ['coding', 'vision'], artifactType: 'web', executionMode: 'html', referenceKind: 'web', inputs: [], reference: null, instructions: '返回完整 HTML，样式和脚本内联，不依赖外部网络。', sample: true },
  { id: 'sample-sort', title: '排序算法可视化', prompt: '写一个排序算法可视化页面，包含冒泡、快排和归并三种，可调速、可暂停，每步高亮比较与交换。用 Canvas 实现，不要用动画库。', scene: 'code', capabilities: ['coding', 'long'], artifactType: 'web', executionMode: 'html', referenceKind: 'code', inputs: [], reference: null, instructions: '输出自包含 HTML 文件。', sample: true },
  { id: 'sample-video', title: '投影仪产品短片', prompt: '为一款便携投影仪做 30 秒产品短片，包含暗场客厅、光束打在墙上和手持开箱三个段落，节奏前慢后快，结尾落在品牌 logo。', scene: 'video', capabilities: ['long', 'vision'], artifactType: 'video', executionMode: 'harness', referenceKind: 'video', inputs: [], reference: null, instructions: '需要支持视频生成的工具，最终产物应为视频文件。', sample: true },
  { id: 'sample-chart', title: '季度销售图表', prompt: '把四个季度的渠道销售数据做成一张信息图。官网销售依次为 120、180、210、260，渠道销售为 80、100、150、170，单位万元。主图用堆叠柱显示渠道构成，副图用折线显示总额，右上角放关键数字，配色不超过四色。', scene: 'dataviz', capabilities: ['chart', 'vision'], artifactType: 'web', executionMode: 'html', referenceKind: 'chart', inputs: [], reference: null, instructions: '输出自包含 HTML，保证图表数值可核对。', sample: true },
  { id: 'sample-copy', title: '落地页三组文案', prompt: '为 AI 会议纪要产品写三组主标题和副标题。一组讲效率、一组讲准确、一组讲团队协作。每组主标题不超过 12 字，不要用「赋能」「重塑」。', scene: 'landing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', referenceKind: 'copy', inputs: [], reference: null, instructions: '', sample: true },
  { id: 'sample-article', title: '把技术讲给普通人', prompt: '用 300 字解释为什么同一条提示词在不同模型上会得到不同答案。读者没有技术背景，给一个日常例子，不要用营销语气。', scene: 'writing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', referenceKind: 'copy', inputs: [], reference: null, instructions: '', sample: true }
];
export async function seedStore(store: Store) {
  const [{ n }] = await store.db.select({ n: count() }).from(cases);
  const marked=(await store.db.select().from(editorialRecords).where(eq(editorialRecords.id,'system_seeded')))[0];if(marked)return;
  if(n){const at=new Date().toISOString();await store.db.insert(editorialRecords).values({id:'system_seeded',kind:'system',data:{seeded:true},createdAt:at,updatedAt:at}).onConflictDoNothing();return;}
  const at = new Date().toISOString();
  await store.db.transaction(async tx => {
    await tx.insert(editorialRecords).values({id:'system_seeded',kind:'system',data:{seeded:true},createdAt:at,updatedAt:at}).onConflictDoNothing();
    for (const entry of samples) {
      const { id, ...data } = entry;
      const versionId = `${id}-v1`;
      await tx.insert(cases).values({ id, versionId, version: 1, createdAt: at, updatedAt: at }).onConflictDoNothing();
      await tx.insert(caseVersions).values({ id: versionId, caseId: id, version: 1, data, hash: digest(data), createdAt: at }).onConflictDoNothing();
    }
  });
}
