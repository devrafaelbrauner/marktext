// The whole Lucide set (geometry and tags, ~600 KB of JSON). Only imported
// dynamically through `lucidePack` so it lands in its own lazy chunk.
import iconNodes from 'lucide-static/icon-nodes.json'
import iconTags from 'lucide-static/tags.json'
import { createIconPack, type IconNode } from '../common/pack'
import { LUCIDE_PREFIX } from '../common/shortcode'

// The JSON infers element tuples as `(string | {…})[]`; lucide-static
// documents each node as `[tagName, attributes]`.
const nodes = iconNodes as unknown as Record<string, IconNode[]>

export default createIconPack(LUCIDE_PREFIX, nodes, iconTags)
