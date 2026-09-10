/**
 * 英文覆盖字典。
 * 约定：以「后端返回的中文 message 原文」为 key，英文为 value。
 * 既覆盖 McpError（zhByCode 模板）也覆盖 NestJS HttpException 的中文文案。
 * 插值占位符 `{name}` 必须原样保留在 value 中。
 */
export const en: Record<string, string> = {
  // ===== McpError 错误码 =====
  '缺少 Authorization: Bearer <nppt_xxx> 请求头': 'Missing Authorization: Bearer <nppt_xxx> header',
  'API Key 无效': 'Invalid API Key',
  'API Key 已被吊销': 'API Key has been revoked',
  '缺少 x-admin-key 请求头': 'Missing x-admin-key header',
  'x-admin-key 不匹配': 'x-admin-key mismatch',
  '未配置 NOPPT_ADMIN_KEY，管理接口不可用':
    'NOPPT_ADMIN_KEY is not set; management API unavailable',
  '调用过于频繁，请在 {seconds}s 后重试': 'Rate limit exceeded. Please retry after {seconds}s',
  'topic 为必填参数': 'topic is required',
  '参数越界：{detail}': 'Argument out of range: {detail}',
  'referenceHtml 超过 2MB 上限，请精简后再提交':
    'referenceHtml exceeds the 2MB limit; please trim it and retry',
  'referenceImage 超过大小上限': 'referenceImage exceeds the size limit',
  '参数校验失败：{detail}': 'Validation failed: {detail}',
  '演示 {id} 不存在或不属于当前作用域':
    'Presentation {id} does not exist or is outside the current scope',
  '{field} 不能为空': '{field} must not be empty',
  演示文稿不存在: 'Presentation not found',
  '未找到第 {index} 页': 'Slide {index} not found',
  '第 {slideIndex} 页第 {elementIndex} 个元素缺少 selector，无法定位':
    'Slide {slideIndex} element {elementIndex} is missing a selector and cannot be located',
  '整份编辑返回 {count} 页，超过 {max} 页上限':
    'Edit returned {count} slides, exceeding the limit of {max}',
  服务器内部错误: 'Internal server error',
  '任务 {jobId} 不存在或已过期': 'Job {jobId} does not exist or has expired',
  草稿不存在: 'Draft not found',
  草稿已过期: 'Draft has expired',

  // 后端显式文案（非模板，整句覆盖）
  '服务端尚未配置可用的模型，请先在「设置」中完成模型配置':
    'No model is configured on the server; please complete model setup in Settings first',
  'MCP 请求处理失败': 'MCP request handling failed',
  'name 必填': 'name is required',
  'API Key {id} 不存在': 'API Key {id} does not exist',

  // 草稿读取端点手写错误体
  '草稿不存在或已被清理，请让助手重新生成一条链接':
    'The draft does not exist or has been cleared; please ask the assistant to regenerate a link',
  '草稿已过期，请让助手重新生成一条链接':
    'The draft has expired; please ask the assistant to regenerate a link',
  草稿不属于当前作用域: 'The draft does not belong to the current scope',
  草稿访问令牌无效: 'Invalid draft access token',
  参数非法: 'Invalid parameters',

  // ===== NestJS HttpException 中文文案 =====
  尚未生成审核报告: 'Audit report has not been generated yet',
  无效的幻灯片索引: 'Invalid slide index',
  截图不存在: 'Screenshot not found',
  产物不存在或不属于该作用域: 'Artifact does not exist or is outside the scope',
  该文件不允许通过静态目录访问: 'This file is not accessible via the static directory',
};
