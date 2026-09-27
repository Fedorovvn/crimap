import { mkdirSync, writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eventSchema, extractionSchema, translationSchema } from './contract.mjs';
import { reviewSchema } from './review.mjs';
import {finalEditorSchema} from './final-editor.mjs';
mkdirSync(new URL('../contracts/v2/',import.meta.url),{recursive:true});
for(const [name,schema] of Object.entries({event:eventSchema,extraction:extractionSchema,translation:translationSchema,review:reviewSchema,'final-review':finalEditorSchema.required({legalCoverage:true})}))writeFileSync(new URL(`../contracts/v2/${name}.schema.json`,import.meta.url),JSON.stringify(zodToJsonSchema(schema,{name}),null,2)+'\n');
