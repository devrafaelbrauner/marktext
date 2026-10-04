import { defineComponent, h, type PropType } from 'vue'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Link,
  Maximize,
  Moon,
  PanelLeft,
  Search,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-static'

export const ICONS = {
  sidebar: PanelLeft,
  previousPage: ChevronUp,
  nextPage: ChevronDown,
  zoomOut: ZoomOut,
  zoomIn: ZoomIn,
  fitWidth: ArrowLeftRight,
  fitPage: Maximize,
  darkPages: Moon,
  find: Search,
  copyLink: Link,
  close: X,
  expand: ChevronRight
} as const

/** Decorative Lucide icon; the SVG markup is static, bundled and trusted. */
export const PdfIcon = defineComponent({
  name: 'PdfIcon',
  props: {
    name: { type: String as PropType<keyof typeof ICONS>, required: true }
  },
  setup(props) {
    return () => h('span', { class: 'pdf-reader-icon', 'aria-hidden': 'true', innerHTML: ICONS[props.name] })
  }
})
