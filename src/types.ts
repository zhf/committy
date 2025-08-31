export interface ChangeItem {
  id: string;
  file: string;
  kind: 'hunk' | 'file';
  patch?: string;
  preview?: string;
}

export interface TopicGroup {
  topic: string;
  items: string[];
}

export interface GitConfig {
  openAIKey: string;
  openAIBaseUrl: string;
}