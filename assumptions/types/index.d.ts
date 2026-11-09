export type Assumption = { id: string; text: string; isEdited: boolean }
export type Problem = {
  id: string
  title: string
  assumptions: Assumption[]
  project: string
  sessionId: string
}
export type Locale = 'en' | 'zh'
export type Mode = 'all' | 'project'

declare module 'claude-code' {
  interface PluginState {
    assumptions: {
      problems: Shaped<Problem[]>
      updating: string[]
      editing: string | null
      locale: Locale
      mode: Mode
    }
  }
}
