declare module "vcf" {
  function VCF(): VCard;

  namespace VCF {
    export const mimeType: string;
    export const extension: string;
    export const versions: string[];
    export const EOL: string;

    export function foldLine(line: string, maxLength?: number): string;
    export function normalize(value: string): string;
    export function isSupported(version: string): boolean;
    export function parse(vcfString: string): VCard[];
    export function parseLines(lines: string[]): VCard[];
    export function fromJSON(jcard: any): VCard;
    export function format(card: VCard, version?: string): string;

    export class Property {
      name: string;
      value: any;
      constructor(name: string, value: any, params?: any);
      valueOf(): any;
    }
  }

  interface VCard {
    get(property: string): VCF.Property | VCF.Property[] | undefined;
    set(property: string, value: any, params?: any): VCard;
    add(property: string, value: any, params?: any): VCard;
    setProperty(prop: VCF.Property): VCard;
    addProperty(prop: VCF.Property): VCard;
    parse(data: string): VCard;
    toString(version?: string): string;
    toJCard(): any;
    toJSON(): any;
  }

  export = VCF;
}
