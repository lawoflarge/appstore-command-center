import type { Config } from "@/lib/store/paths";

export function applyConfigPatch(cfg: Config, patch: {
  appId: string; hidden?: boolean; archived?: boolean;
  keywords?: { term: string; country: string }[];
}): Config {
  const cur = cfg.apps[patch.appId] ?? { hidden: false, archived: false, keywords: [] };
  return {
    apps: {
      ...cfg.apps,
      [patch.appId]: {
        hidden: patch.hidden ?? cur.hidden,
        archived: patch.archived ?? cur.archived,
        keywords: patch.keywords ?? cur.keywords,
        goalDownloadsPerMonth: cur.goalDownloadsPerMonth,
      },
    },
  };
}
