import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/editor/:id',
      name: 'editor',
      component: () => import('@/views/EditorView.vue'),
    },
    {
      path: '/templates/:id',
      name: 'template-editor',
      component: () => import('@/views/TemplateEditorView.vue'),
    },
  ],
})

export default router
