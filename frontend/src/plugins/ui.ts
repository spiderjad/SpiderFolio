// Lo que la app ofrece a los plugins para armar sus pantallas: los mismos componentes del núcleo, desde
// un solo lugar. Un plugin importa de acá (y del SDK), nunca de otras carpetas de la app.
export { Button } from "@/components/ui/button";
export {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  Eyebrow,
  IconTile,
  Skeleton,
} from "@/components/ui/display";
export {
  Checkbox,
  FormField,
  FormGrid,
  Input,
  Label,
  Switch,
  Textarea,
} from "@/components/ui/form";
export { Dialog, DialogContent } from "@/components/ui/overlay";
export { ConfirmDialog } from "@/components/ui/confirm-dialog";
export { api, ApiError } from "@/lib/api";
export { errorText } from "@/lib/error-text";
export { useMembership } from "@/features/home/workspace-layout";
export { Combobox, useStaticSource, type ComboOption } from "@/components/ui/combobox";
export { ConfirmCodeDialog } from "@/features/profile/two-factor-section";
export { toast } from "sonner";
export { locale, type Locale } from "./locale";
