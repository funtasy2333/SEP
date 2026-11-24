<template>
  <el-dialog
    :model-value="modelValue"
    title="让 AI Agent 通过 MCP 创建或维护模板"
    width="min(620px, calc(100vw - 24px))"
    align-center
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="guide-body" data-testid="agent-template-guide">
      <p class="guide-lead">
        已连接本系统的 AI Agent 可直接调用 MCP 模板工具编制与维护模板；创建或修改完成后，本页会通过 SSE 实时同步显示最新模板。
      </p>

      <section class="guide-section">
        <h4>可用 MCP 模板工具</h4>
        <ul class="tool-list">
          <li><code>list_templates</code>：查看全部内置与自定义模板摘要</li>
          <li><code>get_template</code>：读取模板完整元信息、<code>coverLayout</code> 与正文骨架</li>
          <li><code>create_template</code>：从已有文档或新结构创建自定义模板</li>
          <li><code>update_template</code> / <code>apply_template_operations</code>：局部调整占位符、条款骨架与版式 presets</li>
          <li><code>create_document(templateId)</code>：按指定模板一键实例化新标准文件</li>
        </ul>
      </section>

      <section class="guide-section">
        <div class="prompt-head">
          <h4>示例指令（可直接复制给 AI Agent）</h4>
          <el-button size="small" plain data-testid="copy-agent-prompt-btn" @click="copyPrompt">
            复制提示词
          </el-button>
        </div>
        <pre class="prompt-box">{{ EXAMPLE_PROMPT }}</pre>
      </section>
    </div>

    <template #footer>
      <el-button type="primary" @click="$emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'

defineProps<{
  modelValue: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const EXAMPLE_PROMPT = [
  '请帮我创建一个适用于“XX 行业协会团体标准”的自定义模板：',
  '1. 先调用 list_templates 查看现有模板；',
  '2. 基于团体标准内置模板调用 create_template，预设前缀 T/XXSA、归口单位为“XX 标准化技术委员会”；',
  '3. 在前言与正文第一章保留 {{titleCn}}、{{proposer}} 等占位符，并配置封面附加声明与独立封底。',
].join('\n')

async function copyPrompt(): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(EXAMPLE_PROMPT)
    }
    ElMessage.success('已复制示例提示词')
  } catch {
    ElMessage.warning('当前环境不支持自动复制，请手动选择复制')
  }
}
</script>

<style scoped>
.guide-body {
  display: grid;
  gap: 14px;
}

.guide-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ses-ink-2);
}

.guide-section h4 {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ses-ink);
}

.tool-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--ses-ink-2);
}

.prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.prompt-head h4 {
  margin: 0;
}

.prompt-box {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--ses-line);
  border-radius: 8px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: var(--ses-font-mono);
}
</style>
