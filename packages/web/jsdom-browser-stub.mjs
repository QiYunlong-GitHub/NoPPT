// 浏览器构建用的 jsdom 占位实现。
// jsdom 是 Node 专用库，只在服务端 / 测试里被 reference-html-extractor 实例化，
// 浏览器中永远不会调用，因此把它别名到这个 stub 即可避免把真正的 jsdom 打进浏览器包
// （否则 jsdom 在浏览器求值阶段 `class extends agent-base` 会因 agent-base 为 undefined 而崩溃，导致整页白屏）。
export class JSDOM {
  constructor() {
    throw new Error('jsdom is not available in the browser build');
  }
}
