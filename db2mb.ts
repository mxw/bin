#!/usr/bin/env npx ts-node

import * as fs from 'fs'
import * as path from 'path'

import * as CL from 'ts-command-line-args'
import * as Scry from 'scryfall-sdk'
import { parse as csv_parse } from 'csv-parse/sync'
import { stringify as csv_stringify } from 'csv-stringify/sync';

type Mutable<T> = {
  -readonly [K in keyof T]: Mutable<T[K]>;
}

interface Args {
  csv: string;
  out: string;
  fail: string;
  help?: boolean;
}

const args = CL.parse<Args>({
  csv: {
    type: String,
    description: 'the decked builder collection csv file',
  },
  out: {
    type: String,
    description: 'manabox-compatible output csv location',
  },
  fail: {
    type: String,
    description: 'location to output unconvertible decked builder entries',
  },
  help: {
    type: Boolean,
    alias: 'h',
    optional: true,
    description: 'show usage',
  }
} as any, {
  helpArg: 'help',
  headerContentSections: [{
    header: 'db2mb',
    content: `
convert Decked Builder collection CSV to ManaBox import-compatible CSV

Usage: db2mb.ts <options>
`.trim(),
  }],
});

const { csv, out, fail } = args;

(async () => {

const headers = [
  'Total Qty',
  'Reg Qty',
  'Foil Qty',
  'Card',
  'Set',
  'Mana Cost',
  'Card Type',
  'Color',
  'Rarity',
  'Mvid',
  'Single Price',
  'Single Foil Price',
  'Total Price',
  'Price Source',
  'Notes',
] as const;

type DeckedBuilderRecord = {
  [K in typeof headers[number]]: string;
};

const csv_path = path.resolve(__dirname, csv);

const raw_contents = fs.readFileSync(csv_path);
const fixed_contents = raw_contents.toString().replaceAll(
  'Time Spiral ""Timeshifted""',
  '"Time Spiral ""Timeshifted"""',
);

const records: DeckedBuilderRecord[] = csv_parse(fixed_contents, {
  columns: headers as Mutable<typeof headers>,
  delimiter: ',',
  skip_empty_lines: true,
  from_line: 2,
});

const decked_builder = records.map(item => ({
  reg_qty: parseInt(item['Reg Qty']),
  foil_qty: parseInt(item['Foil Qty']),
  card: item['Card'] as string,
  set: item['Set'] as string,
  rarity: item['Rarity'] as string,
  mvid: parseInt(item['Mvid']),
}));

const good = decked_builder.filter(item => item.mvid < 1000000);
const bad  = decked_builder.filter(item => item.mvid >= 1000000);

const collection = good.map(
  item => Scry.CardIdentifier.byMultiverseId(item.mvid)
);

const cardlist = await Scry.Cards.collection(...collection).waitForAll();

const cards: Record<number, Scry.Card> = {};
for (let card of cardlist) {
  for (let mvid of card.multiverse_ids) {
    cards[mvid] = card;
  }
}

const manabox = good.map(item => [{
  quantity: item.reg_qty,
  foil: '',
  'scryfall id': cards[item.mvid].id,
}, {
  quantity: item.foil_qty,
  foil: '1',
  'scryfall id': cards[item.mvid].id,
}]).flat().filter(item => item.quantity > 0);

const manabad = bad.map(item => [{
  quantity: item.reg_qty,
  'card name': item.card,
  'set name': item.set,
  foil: '',
}, {
  quantity: item.foil_qty,
  'card name': item.card,
  'set name': item.set,
  foil: '1',
}]).flat().filter(item => item.quantity > 0);

const out_path = path.resolve(__dirname, out);
const fail_path = path.resolve(__dirname, fail);

fs.mkdirSync(path.dirname(out_path), {recursive: true});
fs.mkdirSync(path.dirname(fail_path), {recursive: true});

fs.writeFileSync(out_path,  csv_stringify(manabox, {header: true}));
fs.writeFileSync(fail_path, csv_stringify(manabad, {header: true}));

})();
