export type Todo = { id: string; text: string; isManual: boolean }
export type Chat = {
  sessionId: string
  title: string
  project: string
  todos: Todo[]
  dismissed: string[]
}
export type Locale = 'en' | 'zh'

declare module 'claude-code' {
  interface PluginState {
    pending: {
      chats: Shaped<Chat[]>
      locale: Locale
    }
  }
}
