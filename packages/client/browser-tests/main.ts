import '../src/styles/tokens.css'
import '../src/styles/app.css'
import { createApp, h } from 'vue'
import { Editor } from '@tiptap/core'
import EditorContent from '../src/components/editor/EditorContent.vue'
import { createEditorExtensions } from '../src/extensions/editorExtensions'
import fixture from './fixture.json'
const editor = new Editor({ extensions: createEditorExtensions(), content: { type: 'doc', content: [fixture] } })
;(window as any).editor = editor
createApp({ render: () => h(EditorContent, { editor }) }).mount('#app')
