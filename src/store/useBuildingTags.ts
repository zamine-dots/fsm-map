import { create } from 'zustand';
import { BUILDING_TAGS_KEY, parseBuildingTag, parseBuildingTags, parseBuildingTagsBackup, serializeBuildingTags, type BuildingTag } from '../lib/building-tags';
import { CAN_EDIT_CAMPUS } from '../lib/campus-editing';
import { publishedRoomTags } from '../lib/published-room-locations';

type TagStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StorageStatus = 'ready' | 'unavailable' | 'corrupt' | 'conflict';
interface BuildingTagsState {
  tags: BuildingTag[];
  status: StorageStatus;
  dirty: boolean;
  originalRaw: string | null;
  saveTag: (tag: BuildingTag, original?: BuildingTag) => void;
  deleteTag: (tag: BuildingTag) => void;
  retry: (replace?: boolean) => void;
  reload: () => void;
  replaceTags: (tags: BuildingTag[]) => void;
}

export function createBuildingTagStore(storage: TagStorage | null, { editable = true, initialTags = [] }: { editable?: boolean; initialTags?: BuildingTag[] } = {}) {
  const defaults = parseBuildingTags(initialTags);
  const requireEditing = () => { if (!editable) throw new Error('Édition des salles disponible uniquement en local.'); };
  const read = (): { tags: BuildingTag[]; raw: string | null; status: Exclude<StorageStatus, 'conflict'> } => {
    if (!editable) return { tags: defaults, raw: null, status: 'ready' };
    let raw: string | null;
    try { if (!storage) throw new Error(); raw = storage.getItem(BUILDING_TAGS_KEY); }
    catch { return { tags: defaults, raw: null, status: 'unavailable' }; }
    try { return { tags: raw === null ? defaults : parseBuildingTagsBackup(raw), raw, status: 'ready' }; }
    catch { return { tags: [], raw, status: 'corrupt' }; }
  };
  const initial = read();
  let baseline = initial.raw;
  return create<BuildingTagsState>((set, get) => {
    const save = (tags: BuildingTag[], replace = false) => {
      const raw = serializeBuildingTags(tags);
      if (!replace && ['corrupt', 'conflict'].includes(get().status)) { set({ tags, dirty: true }); return; }
      try {
        if (!storage) throw new Error();
        const current = storage.getItem(BUILDING_TAGS_KEY);
        if (!replace && current !== baseline) { set({ tags, status: 'conflict', dirty: true, originalRaw: current }); return; }
        storage.setItem(BUILDING_TAGS_KEY, raw);
        baseline = raw;
        set({ tags, status: 'ready', dirty: false, originalRaw: null });
      } catch { set({ tags, status: 'unavailable', dirty: true }); }
    };
    const checkOriginal = (original: BuildingTag) => {
      if (JSON.stringify(get().tags.find((tag) => tag.id === original.id)) !== JSON.stringify(original)) {
        throw new Error('Ce tag a changé dans un autre onglet. Fermez l’édition puis ouvrez-le à nouveau.');
      }
    };
    return {
      tags: initial.tags, status: initial.status, dirty: false, originalRaw: initial.status === 'corrupt' ? initial.raw : null,
      saveTag: (input, original) => {
        requireEditing();
        const tag = parseBuildingTag(input);
        if (original) {
          checkOriginal(original);
          if (tag.id !== original.id || tag.buildingId !== original.buildingId) throw new Error('Un tag doit rester rattaché à son bâtiment d’origine.');
        }
        else if (get().tags.some((entry) => entry.id === tag.id)) throw new Error('Identifiant déjà utilisé.');
        save(original ? get().tags.map((entry) => entry.id === tag.id ? tag : entry) : [...get().tags, tag]);
      },
      deleteTag: (tag) => { requireEditing(); checkOriginal(tag); save(get().tags.filter((entry) => entry.id !== tag.id)); },
      retry: (replace = false) => { requireEditing(); save(get().tags, replace); },
      replaceTags: (tags) => { requireEditing(); save(tags.map(parseBuildingTag), true); },
      reload: () => {
        if (!editable) return;
        const loaded = read();
        if (get().dirty) {
          if (loaded.raw !== baseline) set({ status: 'conflict', originalRaw: loaded.raw });
          return;
        }
        baseline = loaded.raw;
        set({ tags: loaded.status === 'ready' ? loaded.tags : get().tags, status: loaded.status, originalRaw: loaded.status === 'corrupt' ? loaded.raw : null });
      },
    };
  });
}

let storage: Storage | null = null;
try { if (CAN_EDIT_CAMPUS) storage = window.localStorage; } catch { /* Local drafts remain usable in memory. */ }
export const useBuildingTags = createBuildingTagStore(storage, { editable: CAN_EDIT_CAMPUS, initialTags: CAN_EDIT_CAMPUS ? publishedRoomTags : [] });
