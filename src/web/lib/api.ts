import type {
  AccountInfo,
  AddResult,
  AnalyticsData,
  BrowseResult,
  CloudItem,
  Folder,
  FolderInfo,
  Job,
  LogEntry,
  Settings,
  SystemInfo,
  Tag,
  Tick,
} from '../../shared/types';

export interface Bootstrap {
  settings: Settings;
  folders: FolderInfo[];
  tags: Tag[];
  system: SystemInfo;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the Torboxed server');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export type JobAction = 'pause' | 'resume' | 'retry' | 'top' | 'bottom' | 'tag';

export const api = {
  bootstrap: () => request<Bootstrap>('GET', 'api/bootstrap'),
  job: (id: string) => request<Job>('GET', `api/jobs/${id}`),
  add: (form: FormData) => request<AddResult>('POST', 'api/jobs', form),
  action: (ids: string[], action: JobAction, tagId?: string | null) => request('POST', 'api/jobs/action', { ids, action, tagId }),
  remove: (ids: string[], o: { fromList: boolean; fromTorbox: boolean; deleteFiles: boolean }) =>
    request<{ errors: string[] }>('POST', 'api/jobs/remove', { ids, ...o }),
  clear: (status: 'completed' | 'error') => request<{ removed: number }>('POST', 'api/jobs/clear', { status }),
  control: (patch: { globalPaused?: boolean; slowMode?: boolean }) => request<Tick>('POST', 'api/control', patch),
  saveSettings: (patch: Partial<Settings> | Record<string, unknown>) => request<Settings>('PUT', 'api/settings', patch),
  testKey: (apiKey: string) => request<AccountInfo>('POST', 'api/torbox/test', { apiKey }),
  account: (force = false) => request<AccountInfo>('GET', `api/torbox/account${force ? '?force=1' : ''}`),
  cloud: (force = false) => request<CloudItem[]>('GET', `api/torbox/cloud${force ? '?force=1' : ''}`),
  cloudDownload: (id: number, tagId: string | null, folderId?: string) =>
    request('POST', `api/torbox/cloud/${id}/download`, { tagId, folderId }),
  cloudDelete: (id: number) => request('DELETE', `api/torbox/cloud/${id}`),
  folders: () => request<FolderInfo[]>('GET', 'api/folders'),
  createFolder: (f: Omit<Folder, 'id'>) => request<Folder>('POST', 'api/folders', f),
  updateFolder: (id: string, f: Omit<Folder, 'id'>) => request<Folder>('PUT', `api/folders/${id}`, f),
  deleteFolder: (id: string) => request('DELETE', `api/folders/${id}`),
  tags: () => request<Tag[]>('GET', 'api/tags'),
  createTag: (t: Omit<Tag, 'id'>) => request<Tag>('POST', 'api/tags', t),
  updateTag: (id: string, t: Omit<Tag, 'id'>) => request<Tag>('PUT', `api/tags/${id}`, t),
  deleteTag: (id: string) => request('DELETE', `api/tags/${id}`),
  browse: (p?: string) => request<BrowseResult>('GET', `api/fs/browse${p ? `?path=${encodeURIComponent(p)}` : ''}`),
  mkdir: (p: string) => request<{ path: string }>('POST', 'api/fs/mkdir', { path: p }),
  analytics: (days: number) => request<AnalyticsData>('GET', `api/analytics?days=${days}`),
  resetAnalytics: () => request('POST', 'api/analytics/reset'),
  logs: () => request<LogEntry[]>('GET', 'api/logs'),
  clearLogs: () => request('DELETE', 'api/logs'),
  restore: (data: unknown) => request('POST', 'api/backup/restore', data),
};
