# 案例与素材小框实现及验收

范围为本轮确认的九项任务，不改 Figma、不部署远端、不删除历史业务文件。

## 数据与界面

`packages/core/material-cards.ts` 是公共案例库、素材库、本篇资料和实测素材的共享投影。返回 case/material 两类卡片、独立文件小框、参考／实测分区及原件关系。每次执行保留 caseId；文件保留 parentFileId、instanceId(s)、Agent、模型和文章关联。兼容旧来源关联的文章标签，明确移除的关联优先。

共享组件 `material-card.tsx`、`material-files.tsx` 用于各处卡片、缩略图、预览处理和删除恢复。文章资料默认不显示常驻勾选与星形，不再提供选用、测试；提示词、发起测试位于案例详情。现有筛选字典保留，卡片能力徽章移除。素材库恢复入口保留，删除和从本篇移除分开。

## 编码、删除和上下文

媒体处理沿用后台 FFmpeg，GIF／MP4 截取、画面裁剪、宽度及帧率压缩均另存，不覆盖原件。新文件继承文章与实测来源。正文中使用的媒体在删除时返回 409，回收站不物理删除文件。全批次修改在一个事务内执行。

文章关联素材可由编辑器插入，也可被本篇工具按需读取；取消关联不会将无关文件加入上下文。原有选用状态仅兼容旧记录，新的资料卡不以选用作为前置条件。

## 提示词

`task-prompt.mjs` 区分真实测试和内部 writing/media 工作。普通测试 prompt 原样下发，旧 instructions 不传入 API、prompt.txt 或外部执行器 task.json。原生适配不附加 HTML_DELIVERY。原始历史记录不改。写作和媒体工具任务仍保留内部协议；权限配置没有扩大。

## 验收对应

| 任务 | 证据 |
|---|---|
| 案例／素材区分、同一记录 | material-cards.test.ts：公共库与文章卡 ID 一致、实例分组、标签兼容 |
| 实际素材小框、Agent／模型 | 共享 MaterialFiles 与实测分区；本地实际 MONIAC 和体素卡验收 |
| 紧凑列与缩略图、受限预览 | material-grid.css；本地页面验收图 |
| GIF／MP4、裁剪压缩、删除恢复 | material-cards.test.ts 实际 FFmpeg；网页原帖视频转一秒 GIF、删除、恢复 |
| 文章标签同步及继承 | article-associations.test.ts + material-cards.test.ts；同一素材投影 |
| 精简与批量管理 | MaterialCardView／ArticleMaterials；原始分类筛选仍可用 |
| 实测与素材库共享 | caseId + instanceIds 投影；新截图继承关联测试、重命名与删除投影测试 |
| 执行指标及原会话保留 | UnifiedResults 原记录页；真实 MONIAC 指标与会话界面检查 |
| 删除产物要求及附加提示 | 真实 API 请求体、实际子进程 prompt.txt/task.json 检查；原生适配 mock 子进程测试 |

初始相关测试 54 项；补充历史关联与本篇工具权限等检查后，全项目 114 项通过。类型检查和生产构建通过。首次 UI 验收发现旧案例网格样式优先级覆盖、缩略图被拉高，已加定向样式修正并重新构建。

真实网页操作生成 `file_67cf9975a025487fa02bfff8a9d93064`，来自原帖视频一秒片段、宽度 320 的 GIF，163103 字节；已通过网页删除到回收站后恢复，保留原视频与文章关联，没有写入正文。
