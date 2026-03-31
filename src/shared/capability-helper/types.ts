export type TaskDomain = 'browser' | 'desktop' | 'filesystem' | 'terminal' | 'cross_system';

export type FileKind = 'image' | 'video' | 'code' | 'document' | 'folder' | 'other';

export type TaskPageType =
  | 'home'
  | 'video'
  | 'search_results'
  | 'inbox'
  | 'thread'
  | 'repository'
  | 'folder'
  | 'unknown';

export interface TaskContext {
  domain: TaskDomain;
  app?: string;
  site?: string;
  pageType?: TaskPageType;
  currentUrl?: string;
  pageTitle?: string;
  signedIn?: boolean;
  repoOpen?: boolean;
  repoType?: 'node' | 'python' | 'unknown';
  selectedFiles?: Array<{ path: string; kind: FileKind }>;
  activeFilePath?: string;
  lastAction?: string;
  lastActionStatus?: 'success' | 'error' | 'partial';
  recentIntent?: string;
}

export interface CapabilitySuggestion {
  id: string;
  label: string;
  prompt: string;
  domain: TaskDomain;
  required?: Partial<TaskContext>;
  optionalMatches?: Partial<TaskContext>;
  blockedIf?: Partial<TaskContext>;
  priority: number;
  tags?: string[];
}

export interface HelperSuggestionItem {
  id: string;
  label: string;
  prompt: string;
}

export interface HelperBlockModel {
  title: string;
  suggestions: HelperSuggestionItem[];
  collapsedByDefault: boolean;
  contextKey?: string;
}
