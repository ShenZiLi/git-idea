export interface LogFilters {
  search: string;
  ref: string;
  author: string;
  since: string;
  file: string;
  limit: number;
  refs?: string[];
  authors?: string[];
  paths?: string[];
  until?: string;
  regex?: boolean;
  matchCase?: boolean;
  order?: "date" | "topo";
  firstParent?: boolean;
  noMerges?: boolean;
}

export interface LogPerson {
  name: string;
  email: string;
}

export interface LogLocation {
  hash: string;
  limit: number;
  anchor: boolean;
}

export const LOG_PAGE_SIZE = 300;
export const LOG_MAX_COUNT = 50000;
