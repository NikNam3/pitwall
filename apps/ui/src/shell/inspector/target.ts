import type { ResolvedLink } from '../../kit/types.ts';

/** What the inspector needs of a clicked panel: its link and the params of its topics, read live. */
export type InspectTarget = { link: () => ResolvedLink | undefined; params: (topic: string) => object };
