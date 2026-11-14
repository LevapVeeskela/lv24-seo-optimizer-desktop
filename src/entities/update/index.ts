export { UpdateStore } from "./model/UpdateStore";
export type {
  AvailableUpdate,
  UpdateErrorKind,
  UpdateState,
} from "./model/types";
export {
  UPDATE_RELEASE_URL,
  classifyUpdateError,
} from "./lib/errors";
export {
  bundleSupportsAutoUpdate,
  isPortableEngineSource,
  normalizeBundleKind,
} from "./lib/bundle";
