<template>
  <div class="home-view">
    <el-container>
      <el-header class="home-header">
        <h1>SES 标准化文件编辑系统</h1>
        <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
          新建标准文件
        </el-button>
      </el-header>

      <el-main>
        <el-table
          v-loading="store.loading"
          :data="store.documents"
          stripe
          style="width: 100%"
          @row-click="openDocument"
        >
          <el-table-column prop="title" label="文档标题" min-width="200" />
          <el-table-column label="标准类型" width="140">
            <template #default="{ row }">
              {{ standardTypeLabel(row.meta?.standardType) }}
            </template>
          </el-table-column>
          <el-table-column label="阶段" width="120">
            <template #default="{ row }">
              <el-tag :type="stageTagType(row.stage)" size="small">
                {{ stageLabel(row.stage) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button type="danger" text size="small" @click.stop="handleDelete(row)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-main>
    </el-container>

    <!-- 新建文档对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建标准文件" width="720px">
      <el-form :model="createForm" label-position="top">
        <!-- 第一行：文件编号 + 文件名称 -->
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="文件编号">
              <el-input v-model="createForm.standardNo" placeholder="如 GB/T XXXXX-XXXX" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="文件名称" required>
              <el-input v-model="createForm.title" placeholder="请输入标准名称" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 第二行：ICS号 + CCS号 + 文档类别 -->
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="ICS号">
              <el-input v-model="createForm.icsCode" placeholder="如 35.240" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="CCS号">
              <el-input v-model="createForm.ccsCode" placeholder="如 L70" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="文档类别">
              <el-select v-model="createForm.standardType" style="width: 100%">
                <el-option label="国家标准" value="national" />
                <el-option label="行业标准" value="industry" />
                <el-option label="地方标准" value="local" />
                <el-option label="团体标准" value="group" />
                <el-option label="企业标准" value="enterprise" />
                <el-option label="标准化指导性技术文件" value="guidance" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 第三行：标准发布单位 + 文件阶段 + 标准申请单位 -->
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="标准发布单位">
              <el-input v-model="createForm.issuer" placeholder="如 国家标准化管理委员会" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="文件阶段">
              <el-select v-model="createForm.stage" style="width: 100%">
                <el-option label="工作草案" value="working_draft" />
                <el-option label="征求意见稿" value="comment_draft" />
                <el-option label="送审讨论稿" value="review_discussion_draft" />
                <el-option label="送审稿" value="review_draft" />
                <el-option label="报批稿" value="approval_draft" />
                <el-option label="公示稿" value="public_draft" />
                <el-option label="发布稿" value="published" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="标准申请单位">
              <el-input v-model="createForm.applicant" placeholder="请输入申请单位" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useDocumentStore } from '@/stores/document'

const router = useRouter()
const store = useDocumentStore()

const showCreateDialog = ref(false)

const defaultForm = () => ({
  title: '',
  standardNo: '',
  icsCode: '',
  ccsCode: '',
  standardType: 'national',
  stage: 'working_draft',
  issuer: '',
  applicant: '',
})

const createForm = ref(defaultForm())

onMounted(() => {
  store.fetchDocuments()
})

async function handleCreate() {
  if (!createForm.value.title.trim()) {
    ElMessage.warning('请输入文件名称')
    return
  }
  const f = createForm.value
  const doc = await store.createDocument({
    title: f.title,
    meta: {
      titleCn: f.title,
      standardNo: f.standardNo || undefined,
      icsCode: f.icsCode || undefined,
      ccsCode: f.ccsCode || undefined,
      standardType: f.standardType,
      issuer: f.issuer || undefined,
      applicant: f.applicant || undefined,
    },
    stage: f.stage,
    content: {},
  })
  showCreateDialog.value = false
  createForm.value = defaultForm()
  router.push({ name: 'editor', params: { id: doc.id } })
}

function openDocument(row: { id: number }) {
  router.push({ name: 'editor', params: { id: row.id } })
}

async function handleDelete(row: { id: number; title: string }) {
  await ElMessageBox.confirm(`确定删除文档"${row.title}"吗？`, '确认删除', {
    type: 'warning',
  })
  await store.deleteDocument(row.id)
  ElMessage.success('已删除')
}

function standardTypeLabel(type: string) {
  const map: Record<string, string> = {
    national: '国家标准',
    industry: '行业标准',
    local: '地方标准',
    group: '团体标准',
    enterprise: '企业标准',
    guidance: '标准化指导性技术文件',
  }
  return map[type] || type
}

function stageLabel(stage: string) {
  const map: Record<string, string> = {
    working_draft: '工作草案',
    comment_draft: '征求意见稿',
    review_discussion_draft: '送审讨论稿',
    review_draft: '送审稿',
    approval_draft: '报批稿',
    public_draft: '公示稿',
    published: '发布稿',
  }
  return map[stage] || stage
}

function stageTagType(stage: string) {
  const map: Record<string, string> = {
    working_draft: 'info',
    comment_draft: 'warning',
    review_discussion_draft: 'warning',
    review_draft: '',
    approval_draft: 'success',
    public_draft: 'success',
    published: 'danger',
  }
  return (map[stage] || '') as '' | 'success' | 'warning' | 'info' | 'danger'
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('zh-CN')
}
</script>

<style scoped>
.home-view {
  height: 100vh;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color);
}

.home-header h1 {
  font-size: 20px;
  margin: 0;
}
</style>
