import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import router from './router'
import App from './App.vue'

// === SES design system ===
// Order matters:
//   1. tokens.css            — defines --ses-* variables (must come first)
//   2. element-overrides.css — maps Element Plus vars to ours (AFTER element index.css)
//   3. app.css               — shared helper classes (.ses-brand, .ses-stage, etc.)
//   4. standard-nodes.css    — document node typography
import './styles/tokens.css'
import './styles/element-overrides.css'
import './styles/app.css'
import './styles/standard-nodes.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
