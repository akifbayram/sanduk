import {
  binName,
  fail,
  filterCreateBinItems,
  MAX_AREA_NAME,
  normalizeAddItems,
  type OperationType,
  type OpInput,
  optionalRecord,
  optionalString,
  optionalTrimmedString,
  requireNonEmptyArray,
  requireString,
  stringArray,
  validateAreaName,
} from './batchInputHelpers.js';
import type { CommandAction } from './commandParser.js';
import { validateBinName } from './validation.js';

type Validator = (op: OpInput, index: number) => CommandAction;

export function isOperationType(value: unknown): value is OperationType {
  return typeof value === 'string' && Object.hasOwn(OPERATION_VALIDATORS, value);
}

export const OPERATION_VALIDATORS: Record<OperationType, Validator> = {
  create_bin(op, i) {
    const name = validateBinName(op.name);
    validateAreaName(op.area_name, i);
    return {
      type: 'create_bin',
      name,
      area_name: optionalTrimmedString(op, 'area_name'),
      tags: Array.isArray(op.tags) ? stringArray(op.tags) : undefined,
      items: filterCreateBinItems(op.items),
      color: optionalString(op, 'color'),
      icon: optionalString(op, 'icon'),
      notes: optionalString(op, 'notes'),
      card_style: optionalString(op, 'card_style'),
      custom_fields: optionalRecord(op.custom_fields),
    };
  },

  update_bin(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'update_bin');
    validateAreaName(op.area_name, i);
    const visibility = op.visibility === 'location' || op.visibility === 'private' ? op.visibility : undefined;
    return {
      type: 'update_bin',
      bin_id,
      bin_name: binName(op),
      name: optionalTrimmedString(op, 'name'),
      notes: optionalString(op, 'notes'),
      tags: Array.isArray(op.tags) ? stringArray(op.tags) : undefined,
      area_name: optionalTrimmedString(op, 'area_name'),
      icon: optionalString(op, 'icon'),
      color: optionalString(op, 'color'),
      card_style: optionalString(op, 'card_style'),
      visibility,
      custom_fields: optionalRecord(op.custom_fields),
    };
  },

  delete_bin: (op, i) => ({
    type: 'delete_bin',
    bin_id: requireString(op, 'bin_id', i, 'delete_bin'),
    bin_name: binName(op),
  }),

  restore_bin: (op, i) => ({
    type: 'restore_bin',
    bin_id: requireString(op, 'bin_id', i, 'restore_bin'),
    bin_name: binName(op),
  }),

  add_items(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'add_items');
    const raw = requireNonEmptyArray(op, 'items', i, 'add_items');
    return {
      type: 'add_items',
      bin_id,
      bin_name: binName(op),
      items: normalizeAddItems(raw),
    };
  },

  remove_items(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'remove_items');
    const raw = requireNonEmptyArray(op, 'items', i, 'remove_items');
    return {
      type: 'remove_items',
      bin_id,
      bin_name: binName(op),
      items: stringArray(raw),
    };
  },

  modify_item(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'modify_item');
    if (typeof op.old_item !== 'string' || typeof op.new_item !== 'string') {
      fail(i, 'modify_item requires "old_item" and "new_item"');
    }
    return {
      type: 'modify_item',
      bin_id,
      bin_name: binName(op),
      old_item: op.old_item.trim(),
      new_item: op.new_item.trim(),
    };
  },

  set_item_quantity(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'set_item_quantity');
    const item_name = requireString(op, 'item_name', i, 'set_item_quantity').trim();
    if (!item_name) fail(i, 'set_item_quantity requires non-empty "item_name"');
    if (typeof op.quantity !== 'number' || !Number.isFinite(op.quantity)) {
      fail(i, 'set_item_quantity requires numeric "quantity"');
    }
    return {
      type: 'set_item_quantity',
      bin_id,
      bin_name: binName(op),
      item_name,
      quantity: Math.floor(op.quantity),
    };
  },

  add_tags(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'add_tags');
    const raw = requireNonEmptyArray(op, 'tags', i, 'add_tags');
    return {
      type: 'add_tags',
      bin_id,
      bin_name: binName(op),
      tags: stringArray(raw),
    };
  },

  remove_tags(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'remove_tags');
    const raw = requireNonEmptyArray(op, 'tags', i, 'remove_tags');
    return {
      type: 'remove_tags',
      bin_id,
      bin_name: binName(op),
      tags: stringArray(raw),
    };
  },

  modify_tag(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'modify_tag');
    if (typeof op.old_tag !== 'string' || typeof op.new_tag !== 'string') {
      fail(i, 'modify_tag requires "old_tag" and "new_tag"');
    }
    return {
      type: 'modify_tag',
      bin_id,
      bin_name: binName(op),
      old_tag: op.old_tag.trim(),
      new_tag: op.new_tag.trim(),
    };
  },

  set_area(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'set_area');
    if (typeof op.area_name !== 'string') {
      fail(i, 'set_area requires "area_name"');
    }
    if (op.area_name.length > MAX_AREA_NAME) {
      fail(i, `area_name exceeds ${MAX_AREA_NAME} characters`);
    }
    return {
      type: 'set_area',
      bin_id,
      bin_name: binName(op),
      area_id: typeof op.area_id === 'string' ? op.area_id : null,
      area_name: op.area_name.trim(),
    };
  },

  set_notes(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'set_notes');
    const mode = op.mode;
    if (mode !== 'set' && mode !== 'append' && mode !== 'clear') {
      fail(i, 'set_notes requires "mode" (set|append|clear)');
    }
    return {
      type: 'set_notes',
      bin_id,
      bin_name: binName(op),
      notes: typeof op.notes === 'string' ? op.notes : '',
      mode,
    };
  },

  set_icon(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'set_icon');
    if (typeof op.icon !== 'string') {
      fail(i, 'set_icon requires "icon"');
    }
    return { type: 'set_icon', bin_id, bin_name: binName(op), icon: op.icon };
  },

  set_color(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'set_color');
    if (typeof op.color !== 'string') {
      fail(i, 'set_color requires "color"');
    }
    return { type: 'set_color', bin_id, bin_name: binName(op), color: op.color };
  },

  duplicate_bin(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'duplicate_bin');
    return {
      type: 'duplicate_bin',
      bin_id,
      bin_name: binName(op),
      new_name: optionalTrimmedString(op, 'new_name'),
    };
  },

  pin_bin: (op, i) => ({
    type: 'pin_bin',
    bin_id: requireString(op, 'bin_id', i, 'pin_bin'),
    bin_name: binName(op),
  }),

  unpin_bin: (op, i) => ({
    type: 'unpin_bin',
    bin_id: requireString(op, 'bin_id', i, 'unpin_bin'),
    bin_name: binName(op),
  }),

  rename_area(op, i) {
    const area_id = requireString(op, 'area_id', i, 'rename_area');
    const new_name = requireString(op, 'new_name', i, 'rename_area');
    if (new_name.length > MAX_AREA_NAME) {
      fail(i, `new_name exceeds ${MAX_AREA_NAME} characters`);
    }
    return {
      type: 'rename_area',
      area_id,
      area_name: (op.area_name as string) || '',
      new_name: new_name.trim(),
    };
  },

  delete_area(op, i) {
    const area_id = requireString(op, 'area_id', i, 'delete_area');
    return {
      type: 'delete_area',
      area_id,
      area_name: (op.area_name as string) || '',
    };
  },

  set_tag_color(op, i) {
    if (typeof op.tag !== 'string' || !op.tag.trim()) {
      fail(i, 'set_tag_color requires "tag"');
    }
    if (typeof op.color !== 'string') {
      fail(i, 'set_tag_color requires "color"');
    }
    return { type: 'set_tag_color', tag: op.tag.trim(), color: op.color };
  },

  reorder_items(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'reorder_items');
    const raw = requireNonEmptyArray(op, 'item_ids', i, 'reorder_items');
    return {
      type: 'reorder_items',
      bin_id,
      bin_name: binName(op),
      item_ids: raw.filter((id): id is string => typeof id === 'string'),
    };
  },

  checkout_item(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'checkout_item');
    if (typeof op.item_name !== 'string' || !op.item_name.trim()) {
      fail(i, 'checkout_item requires "item_name"');
    }
    return {
      type: 'checkout_item',
      bin_id,
      bin_name: binName(op),
      item_name: op.item_name.trim(),
    };
  },

  return_item(op, i) {
    const bin_id = requireString(op, 'bin_id', i, 'return_item');
    if (typeof op.item_name !== 'string' || !op.item_name.trim()) {
      fail(i, 'return_item requires "item_name"');
    }
    return {
      type: 'return_item',
      bin_id,
      bin_name: binName(op),
      item_name: op.item_name.trim(),
      target_bin_id: typeof op.target_bin_id === 'string' ? op.target_bin_id : undefined,
      target_bin_name: typeof op.target_bin_name === 'string' ? op.target_bin_name : undefined,
    };
  },
};
