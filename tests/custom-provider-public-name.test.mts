import assert from "node:assert/strict";
import { normalizePublicModelName } from "../lib/customProviders";
assert.equal(normalizePublicModelName("deepseek/modelname"), "deepseek-modelname");
assert.equal(normalizePublicModelName("Org / Model Name"), "org-model-name");
assert.equal(normalizePublicModelName("---"), "model");
assert.equal(normalizePublicModelName("Model.V2_preview"), "model.v2_preview");
assert.ok(normalizePublicModelName("x".repeat(200)).length <= 128);
console.log("custom provider public-name tests passed");
