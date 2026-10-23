/** The two kinds of post and the page where each is reviewed. */
export const POST_KINDS = ["news", "character"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const KIND_PATHS = { news: "/admin", character: "/admin/character" } as const satisfies Record<PostKind, string>;
