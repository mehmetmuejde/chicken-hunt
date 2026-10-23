import { CANYON } from "./canyon";
import { CASTLE } from "./castle";
import { CITY_SCENERY } from "./city";
import { COAST } from "./coast";
import { FARM } from "./farm";
import type { SceneryDefinition, SceneryId } from "./kit";
import { MOOR } from "./moor";

export type { Collapse, FarmParts, SceneryDefinition, SceneryId } from "./kit";

export const SCENERIES: Record<SceneryId, SceneryDefinition> = {
  farm: FARM,
  moor: MOOR,
  castle: CASTLE,
  coast: COAST,
  canyon: CANYON,
  city: CITY_SCENERY,
};

export const SCENERY_IDS: readonly SceneryId[] = ["farm", "moor", "castle", "coast", "canyon", "city"];
