import type { McpErrorCode } from '../../common/mcp-errors';

/**
 * 错误码 → 中文模板（向前端/客户端返回 message 的基准文案）。
 * 与 messages/en.ts 一一对应，en 以该中文为 key 提供英文覆盖。
 * 含 `{name}` 占位符，由 McpError 的 params 注入。
 */
export const zhByCode: Record<McpErrorCode, string> = {
  // 认证 / 鉴权
  E1001: '缺少 Authorization: Bearer <nppt_xxx> 请求头',
  E1002: 'API Key 无效',
  E1003: 'API Key 已被吊销',
  E1004: '缺少 x-admin-key 请求头',
  E1005: 'x-admin-key 不匹配',
  E1006: '未配置 NOPPT_ADMIN_KEY，管理接口不可用',

  // 限流
  E2001: '调用过于频繁，请在 {seconds}s 后重试',
  E2002: '调用过于频繁，请在 {seconds}s 后重试',

  // 参数
  E3001: 'topic 为必填参数',
  E3002: '参数越界：{detail}',
  E3003: 'referenceHtml 超过 2MB 上限，请精简后再提交',
  E3004: 'referenceImage 超过大小上限',
  E3005: '参数校验失败：{detail}',

  // 作用域
  E4001: '演示 {id} 不存在或不属于当前作用域',
  E4002: '{field} 不能为空',

  // 业务
  E5001: '演示文稿不存在',
  E5002: '未找到第 {index} 页',
  E5003: '第 {slideIndex} 页第 {elementIndex} 个元素缺少 selector，无法定位',
  E5004: '整份编辑返回 {count} 页，超过 {max} 页上限',
  E5005: '服务器内部错误',
  E5006: '任务 {jobId} 不存在或已过期',
  E5007: '草稿不存在',
  E5008: '草稿已过期',
};
