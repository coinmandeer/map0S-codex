import assert from "node:assert/strict";
import test from "node:test";
import { parseMunicipalPopulation } from "./municipalPopulation.js";

function fixture() {
  return {
    gisco: {
      features: [
        { properties: { GISCO_ID: "ES_43145", YEAR: 2024, POP_2024: 0, AREA_KM2: 35 } },
        { properties: { GISCO_ID: "CZ_554782", YEAR: 2024, POP_2024: 1384732, AREA_KM2: 496 } },
        { properties: { GISCO_ID: "FR_00001", YEAR: 2024, POP_2024: 0, AREA_KM2: 12 } }
      ]
    },
    ine: [
      {
        MetaData: [
          {
            T3_Variable: "Municipios",
            Nombre: "Different spelling must not affect identity",
            Codigo: "43145"
          },
          { T3_Variable: "Sexo", Nombre: "Total", Codigo: "" },
          { T3_Variable: "Nacionalidad", Nombre: "Total", Codigo: "000" },
          { T3_Variable: "Totales de edad", Nombre: "Todas las edades", Codigo: "" },
          { T3_Variable: "Tipo de dato", Nombre: "Dato base", Codigo: "" }
        ],
        Data: [
          { Anyo: 2025, Valor: 5751 },
          { Anyo: 2024, Valor: 5839 }
        ]
      }
    ]
  };
}
test("municipal join uses official codes, pinned year and total population only", () => {
  const input = fixture();
  const male = structuredClone(input.ine[0]!);
  male.MetaData[1]!.Nombre = "Hombres";
  input.ine.push(male);
  const result = parseMunicipalPopulation(input);
  assert.equal(result.observations[0]!.value, 5839);
  assert.equal(result.observations[0]!.geoCode, "ES_43145");
  assert.equal(result.observations[2]!.value, null);
  assert.deepEqual(result.periods, ["2024"]);
  assert.equal(parseMunicipalPopulation(input, true).observations[0]!.value, 5839 / 35);
});
test("missing pinned year and duplicate municipal totals fail before publication", () => {
  const input = fixture();
  input.ine.push(structuredClone(input.ine[0]!));
  assert.throws(() => parseMunicipalPopulation(input), /Duplicate INE/);
  input.ine = [input.ine[0]!];
  input.ine[0]!.Data = [{ Anyo: 2025, Valor: 5751 }];
  assert.throws(() => parseMunicipalPopulation(input), /pinned 2024/);
});
