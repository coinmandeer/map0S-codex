import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __lithologyToCzech, __periodToCzech } from "./geologyService.js";

/**
 * The model, given "Cadomian shale" alongside "Cryogenian – Ediacaran", called the rock Cambrian
 * — a wrong answer that reads exactly like a right one. Period names are a closed vocabulary, so
 * they are translated here instead of being left to judgement.
 */
describe("geological periods in Czech", () => {
  it("translates the periods a Central European map runs into", () => {
    assert.equal(__periodToCzech("Cryogenian"), "kryogén");
    assert.equal(__periodToCzech("Westphalian"), "westfal");
    assert.equal(__periodToCzech("Cretaceous"), "křída");
  });

  it("translates the qualifier along with the period it qualifies", () => {
    assert.equal(__periodToCzech("Early Cretaceous"), "spodní křída");
    assert.equal(__periodToCzech("Late Jurassic"), "svrchní jura");
  });

  it("leaves a name it doesn't know alone rather than half-translating it", () => {
    // "Early" is in the table but "Blahoslavian" is not; a half-Czech name would imply we
    // recognised the period when we didn't.
    assert.equal(__periodToCzech("Blahoslavian"), "Blahoslavian");
    assert.equal(__periodToCzech("Early Blahoslavian"), "spodní Blahoslavian");
  });
});

describe("rock names in Czech", () => {
  it("translates the terms the model got wrong on its own", () => {
    // Asked to render "shale/slate" the model wrote "břidlice a svátky" — slate read as a word
    // about holidays.
    assert.equal(__lithologyToCzech("shale/slate"), "břidlice/jílovitá břidlice");
  });

  it("keeps the punctuation that separates a list of rocks", () => {
    assert.equal(
      __lithologyToCzech("Claystone, sandstone, conglomerate, coal"),
      "Jílovec, pískovec, slepenec, uhlí"
    );
  });

  it("leaves terms outside the vocabulary as they came", () => {
    assert.equal(__lithologyToCzech("migmatite and sandstone"), "migmatite and pískovec");
  });

  it("unpacks the struct some surveys send instead of a sentence", () => {
    assert.equal(
      __lithologyToCzech("Major:{sandstone}, Minor{siltstone,shale}"),
      "pískovec, vedlejší: prachovec, břidlice"
    );
  });
});
