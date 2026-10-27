import { describe, expect, it } from "vitest";
import { parseCsv, readImportRows } from "../src/modules/members/members.csv.ts";

describe("parseCsv", () => {
  it("lee comas, comillas, comillas escapadas y saltos CRLF", () => {
    const csv =
      'email,nombre\r\nana@empresa.com,"Ruiz, Ana"\r\nluis@empresa.com,"Dice ""hola"""\r\n';
    expect(parseCsv(csv)).toEqual([
      ["email", "nombre"],
      ["ana@empresa.com", "Ruiz, Ana"],
      ["luis@empresa.com", 'Dice "hola"'],
    ]);
  });

  it("detecta el punto y coma (Excel en español) y quita el BOM", () => {
    const csv = "﻿email;rol\nana@empresa.com;Miembro\n";
    expect(parseCsv(csv)).toEqual([
      ["email", "rol"],
      ["ana@empresa.com", "Miembro"],
    ]);
  });

  it("descarta filas vacías y acepta una última fila sin salto de línea", () => {
    expect(parseCsv("email\n\n  \nana@empresa.com")).toEqual([["email"], ["ana@empresa.com"]]);
  });

  it("una celda con salto de línea entre comillas sigue siendo una celda", () => {
    expect(parseCsv('email,nota\nana@empresa.com,"línea 1\nlínea 2"')[1]?.[1]).toBe(
      "línea 1\nlínea 2",
    );
  });
});

describe("readImportRows", () => {
  it("reconoce las columnas por nombre (en español o inglés) y numera las líneas", () => {
    const table = parseCsv(
      "Correo,Rol,Departamentos,Plaza\nana@empresa.com,Miembro,Calidad|Producción,full\nluis@empresa.com,,,\n",
    );
    expect(readImportRows(table)).toEqual([
      {
        line: 2,
        email: "ana@empresa.com",
        role: "Miembro",
        departments: ["Calidad", "Producción"],
        seat: "FULL",
      },
      { line: 3, email: "luis@empresa.com", role: "", departments: [], seat: "" },
    ]);
  });

  it("sin columna de email devuelve null", () => {
    expect(readImportRows(parseCsv("nombre,rol\nAna,Miembro"))).toBeNull();
  });

  it("un archivo vacío no tiene filas", () => {
    expect(readImportRows([])).toEqual([]);
  });
});
