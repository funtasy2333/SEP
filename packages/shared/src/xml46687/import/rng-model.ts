import { isXmlElement, MATHML_NS } from '../tree'
import type { XmlAttr, XmlDocument, XmlElement, XmlName } from '../tree'
import { location } from './context'
import type { ImportProblem } from './contracts'

type Pattern = { k: string; name?: string; ns?: string; type?: string; v?: string; c?: Pattern[] }
type Token = XmlElement | string
type State = { i: number; mask: bigint }
// 来源：按文件名字典序对全部 RNG 的文件名、NUL、文件字节、NUL 求 SHA-256。
export const RNG_SOURCE_SHA256 = '5f52012ca15038266b4e6f3fa8b01998d6c6613c6c2aabf24efca980badfc4bf'
// 从 schemas/gbt46687.2/*.rng 固定生成的导入内容模型。
const grammar: Record<string, Pattern> = {
  "el.fig": {"k":"group","c":[{"k":"element","name":"fig","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"orientation","ns":"","c":[{"k":"ref","name":"dt.orientation"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"ref","name":"el.caption"},{"k":"optional","c":[{"k":"ref","name":"el.legend"}]},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.graphic"},{"k":"ref","name":"el.p"},{"k":"ref","name":"el.non-normative-note"},{"k":"ref","name":"el.non-normative-example"}]}]}]}]},
  "el.fig-group": {"k":"group","c":[{"k":"element","name":"fig-group","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"optional","c":[{"k":"ref","name":"el.caption"}]},{"k":"optional","c":[{"k":"ref","name":"el.legend"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.fig"}]}]}]},
  "el.graphic": {"k":"group","c":[{"k":"element","name":"graphic","ns":"","c":[{"k":"ref","name":"attr.xlink-href.req"},{"k":"ref","name":"attr.xlink-type"},{"k":"optional","c":[{"k":"attribute","name":"content-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"image"},{"k":"value","v":"disp_table"},{"k":"value","v":"disp-formula"},{"k":"data","type":"token","c":[{"k":"except","c":[{"k":"choice","c":[{"k":"value","v":"image"},{"k":"value","v":"disp_table"},{"k":"value","v":"disp-formula"}]}]}]}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"specific-use","ns":"","c":[{"k":"ref","name":"dt.size-token"}]}]},{"k":"empty"}]}]},
  "el.inline-graphic": {"k":"group","c":[{"k":"element","name":"inline-graphic","ns":"","c":[{"k":"ref","name":"attr.xlink-href.req"},{"k":"ref","name":"attr.xlink-type"},{"k":"optional","c":[{"k":"attribute","name":"specific-use","ns":"","c":[{"k":"ref","name":"dt.size-token"}]}]},{"k":"empty"}]}]},
  "dt.size-token": {"k":"group","c":[{"k":"choice","c":[{"k":"value","v":"size:T"},{"k":"value","v":"size:S"},{"k":"value","v":"size:M"},{"k":"value","v":"size:L"}]}]},
  "el.legend": {"k":"group","c":[{"k":"element","name":"legend","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.title"}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.def-list"},{"k":"ref","name":"el.p"}]}]}]}]},
  "el.def-list": {"k":"group","c":[{"k":"element","name":"def-list","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"list-content","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"formula"},{"k":"value","v":"figure"},{"k":"value","v":"abbreviation"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"list-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"simple"},{"k":"value","v":"bullet"},{"k":"value","v":"dash"},{"k":"value","v":"symbol"}]}]}]},{"k":"optional","c":[{"k":"ref","name":"el.title"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.def-item"}]}]}]},
  "el.def-item": {"k":"group","c":[{"k":"element","name":"def-item","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"element","name":"term","ns":"","c":[{"k":"ref","name":"cm.term"}]},{"k":"element","name":"def","ns":"","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.p"}]}]}]}]},
  "el.tbx-termEntry": {"k":"group","c":[{"k":"element","name":"termEntry","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"attr.id"},{"k":"oneOrMore","c":[{"k":"ref","name":"el.tbx-langSet"}]}]}]},
  "el.tbx-langSet": {"k":"group","c":[{"k":"element","name":"langSet","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"attr.xml-lang.req"},{"k":"interleave","c":[{"k":"zeroOrMore","c":[{"k":"ref","name":"el.tbx-subjectField"}]},{"k":"optional","c":[{"k":"ref","name":"el.tbx-definition"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.tbx-example"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.tbx-note"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.tbx-source"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.tbx-tig"}]}]}]}]},
  "el.tbx-subjectField": {"k":"group","c":[{"k":"element","name":"subjectField","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"text"}]}]},
  "cm.tbx-inline": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.any"},{"k":"ref","name":"el.tbx-entailedTerm"}]}]}]},
  "el.tbx-definition": {"k":"group","c":[{"k":"element","name":"definition","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"cm.tbx-inline"}]}]},
  "el.tbx-example": {"k":"group","c":[{"k":"element","name":"example","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"cm.tbx-inline"}]}]},
  "el.tbx-note": {"k":"group","c":[{"k":"element","name":"note","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"attr.id"},{"k":"ref","name":"cm.tbx-inline"}]}]},
  "el.tbx-source": {"k":"group","c":[{"k":"element","name":"source","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"text"}]}]},
  "el.tbx-entailedTerm": {"k":"group","c":[{"k":"element","name":"entailedTerm","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"attribute","name":"target","ns":"","c":[{"k":"data","type":"NCName"}]},{"k":"ref","name":"cm.inline"}]}]},
  "el.tbx-tig": {"k":"group","c":[{"k":"element","name":"tig","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"el.tbx-term"},{"k":"optional","c":[{"k":"ref","name":"el.tbx-partOfSpeech"}]},{"k":"optional","c":[{"k":"ref","name":"el.tbx-grammaticalNumber"}]},{"k":"optional","c":[{"k":"ref","name":"el.tbx-normativeAuthorization"}]},{"k":"optional","c":[{"k":"ref","name":"el.tbx-termType"}]}]}]},
  "el.tbx-term": {"k":"group","c":[{"k":"element","name":"term","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"ref","name":"cm.inline"}]}]},
  "el.tbx-partOfSpeech": {"k":"group","c":[{"k":"element","name":"partOfSpeech","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"attribute","name":"value","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"noun"},{"k":"value","v":"verb"},{"k":"value","v":"adj"},{"k":"value","v":"adv"}]}]},{"k":"empty"}]}]},
  "el.tbx-normativeAuthorization": {"k":"group","c":[{"k":"element","c":[{"k":"choice","c":[{"k":"name","ns":"urn:iso:std:iso:30042:ed-1","v":"normativeAuthorization"},{"k":"name","ns":"urn:iso:std:iso:30042:ed-1","v":"normativeAuthentication"}]},{"k":"attribute","name":"value","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"preferredTerm"},{"k":"value","v":"admittedTerm"},{"k":"value","v":"deprecatedTerm"}]}]},{"k":"empty"}]}]},
  "el.tbx-termType": {"k":"group","c":[{"k":"element","name":"termType","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"attribute","name":"value","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"fullForm"},{"k":"value","v":"abbreviation"},{"k":"value","v":"symbol"},{"k":"value","v":"formula"}]}]},{"k":"empty"}]}]},
  "el.tbx-grammaticalNumber": {"k":"group","c":[{"k":"element","name":"grammaticalNumber","ns":"urn:iso:std:iso:30042:ed-1","c":[{"k":"attribute","name":"value","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"singular"},{"k":"value","v":"plural"}]}]},{"k":"empty"}]}]},
  "el.table-wrap": {"k":"group","c":[{"k":"element","name":"table-wrap","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"orientation","ns":"","c":[{"k":"ref","name":"dt.orientation"}]}]},{"k":"optional","c":[{"k":"attribute","name":"position","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"anchor"},{"k":"value","v":"background"},{"k":"value","v":"float"},{"k":"value","v":"margin"}]}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"optional","c":[{"k":"ref","name":"el.caption"}]},{"k":"ref","name":"el.table"},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.graphic"}]},{"k":"optional","c":[{"k":"group","c":[{"k":"ref","name":"el.table-wrap-foot"},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.graphic"}]}]}]}]}]},
  "el.caption": {"k":"group","c":[{"k":"element","name":"caption","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"style","ns":"","c":[{"k":"data","type":"string"}]}]},{"k":"ref","name":"el.title"},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.p"}]}]}]},
  "el.table": {"k":"group","c":[{"k":"element","name":"table","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"width","ns":"","c":[{"k":"data","type":"string","c":[{"k":"param","name":"pattern","v":"[0-9]+(\\.[0-9]+)?%?"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"border","ns":"","c":[{"k":"data","type":"nonNegativeInteger"}]}]},{"k":"optional","c":[{"k":"attribute","name":"frame","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"above"},{"k":"value","v":"below"},{"k":"value","v":"border"},{"k":"value","v":"box"},{"k":"value","v":"hsides"},{"k":"value","v":"lhs"},{"k":"value","v":"rhs"},{"k":"value","v":"void"},{"k":"value","v":"vsides"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"rules","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"all"},{"k":"value","v":"cols"},{"k":"value","v":"groups"},{"k":"value","v":"none"},{"k":"value","v":"rows"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"cellspacing","ns":"","c":[{"k":"data","type":"string","c":[{"k":"param","name":"pattern","v":"[0-9]+%?"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"cellpadding","ns":"","c":[{"k":"data","type":"string","c":[{"k":"param","name":"pattern","v":"[0-9]+%?"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"style","ns":"","c":[{"k":"data","type":"string"}]}]},{"k":"optional","c":[{"k":"choice","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.col"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.colgroup"}]}]}]},{"k":"optional","c":[{"k":"ref","name":"el.thead"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.tbody"}]}]}]},
  "cm.col-attrs": {"k":"group","c":[{"k":"optional","c":[{"k":"attribute","name":"width","ns":"","c":[{"k":"data","type":"string","c":[{"k":"param","name":"pattern","v":"[0-9]+(\\.[0-9]+)?%?"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"align","ns":"","c":[{"k":"ref","name":"dt.align"}]}]},{"k":"optional","c":[{"k":"attribute","name":"valign","ns":"","c":[{"k":"ref","name":"dt.valign"}]}]},{"k":"optional","c":[{"k":"attribute","name":"style","ns":"","c":[{"k":"data","type":"string"}]}]}]},
  "el.col": {"k":"group","c":[{"k":"element","name":"col","ns":"","c":[{"k":"ref","name":"cm.col-attrs"},{"k":"empty"}]}]},
  "el.colgroup": {"k":"group","c":[{"k":"element","name":"colgroup","ns":"","c":[{"k":"ref","name":"cm.col-attrs"},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.col"}]}]}]},
  "cm.row-group-attrs": {"k":"group","c":[{"k":"optional","c":[{"k":"attribute","name":"align","ns":"","c":[{"k":"ref","name":"dt.align"}]}]},{"k":"optional","c":[{"k":"attribute","name":"valign","ns":"","c":[{"k":"ref","name":"dt.valign"}]}]},{"k":"optional","c":[{"k":"attribute","name":"style","ns":"","c":[{"k":"data","type":"string"}]}]}]},
  "el.thead": {"k":"group","c":[{"k":"element","name":"thead","ns":"","c":[{"k":"ref","name":"cm.row-group-attrs"},{"k":"oneOrMore","c":[{"k":"ref","name":"el.tr"}]}]}]},
  "el.tbody": {"k":"group","c":[{"k":"element","name":"tbody","ns":"","c":[{"k":"ref","name":"cm.row-group-attrs"},{"k":"oneOrMore","c":[{"k":"ref","name":"el.tr"}]}]}]},
  "el.tr": {"k":"group","c":[{"k":"element","name":"tr","ns":"","c":[{"k":"ref","name":"cm.row-group-attrs"},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.th"},{"k":"ref","name":"el.td"}]}]}]}]},
  "cm.cell-attrs": {"k":"group","c":[{"k":"optional","c":[{"k":"attribute","name":"align","ns":"","c":[{"k":"ref","name":"dt.align"}]}]},{"k":"optional","c":[{"k":"attribute","name":"valign","ns":"","c":[{"k":"ref","name":"dt.valign"}]}]},{"k":"optional","c":[{"k":"attribute","name":"colspan","ns":"","c":[{"k":"data","type":"positiveInteger"}]}]},{"k":"optional","c":[{"k":"attribute","name":"rowspan","ns":"","c":[{"k":"data","type":"positiveInteger"}]}]},{"k":"optional","c":[{"k":"attribute","name":"style","ns":"","c":[{"k":"data","type":"string"}]}]}]},
  "cm.cell-content": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"cm.inline"},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.p"},{"k":"ref","name":"el.list"}]}]}]}]},
  "el.th": {"k":"group","c":[{"k":"element","name":"th","ns":"","c":[{"k":"ref","name":"cm.cell-attrs"},{"k":"ref","name":"cm.cell-content"}]}]},
  "el.td": {"k":"group","c":[{"k":"element","name":"td","ns":"","c":[{"k":"ref","name":"cm.cell-attrs"},{"k":"optional","c":[{"k":"attribute","name":"scope","ns":"","c":[{"k":"value","v":"row"}]}]},{"k":"ref","name":"cm.cell-content"}]}]},
  "el.table-wrap-foot": {"k":"group","c":[{"k":"element","name":"table-wrap-foot","ns":"","c":[{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.p"},{"k":"ref","name":"el.non-normative-note"},{"k":"ref","name":"el.fn"}]}]}]}]},
  "attr.id": {"k":"group","c":[{"k":"optional","c":[{"k":"attribute","name":"id","ns":"","c":[{"k":"data","type":"NCName"}]}]}]},
  "attr.xlink-type": {"k":"group","c":[{"k":"optional","c":[{"k":"attribute","name":"type","ns":"http://www.w3.org/1999/xlink","c":[{"k":"value","v":"simple"}]}]}]},
  "attr.xlink-href.req": {"k":"group","c":[{"k":"attribute","name":"href","ns":"http://www.w3.org/1999/xlink","c":[{"k":"data","type":"string","c":[{"k":"param","name":"minLength","v":"1"}]}]}]},
  "attr.xml-lang.req": {"k":"group","c":[{"k":"attribute","name":"lang","ns":"http://www.w3.org/XML/1998/namespace","c":[{"k":"data","type":"token","c":[{"k":"param","name":"minLength","v":"1"}]}]}]},
  "dt.align": {"k":"group","c":[{"k":"choice","c":[{"k":"value","v":"left"},{"k":"value","v":"center"},{"k":"value","v":"right"},{"k":"value","v":"justify"},{"k":"value","v":"char"}]}]},
  "dt.valign": {"k":"group","c":[{"k":"choice","c":[{"k":"value","v":"top"},{"k":"value","v":"middle"},{"k":"value","v":"bottom"},{"k":"value","v":"baseline"},{"k":"value","v":"center"}]}]},
  "dt.orientation": {"k":"group","c":[{"k":"choice","c":[{"k":"value","v":"portrait"},{"k":"value","v":"landscape"}]}]},
  "inline.format": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"el.bold"},{"k":"ref","name":"el.italic"},{"k":"ref","name":"el.underline"},{"k":"ref","name":"el.strike"},{"k":"ref","name":"el.monospace"},{"k":"ref","name":"el.sup"},{"k":"ref","name":"el.sub"}]}]},
  "inline.phrase": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"inline.format"},{"k":"ref","name":"el.named-content"},{"k":"ref","name":"el.inline-code"},{"k":"ref","name":"el.inline-graphic"}]}]},
  "cm.inline": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.any"}]}]}]},
  "inline.any": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"inline.mark"},{"k":"ref","name":"el.break"}]}]},
  "inline.mark": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"inline.phrase"},{"k":"ref","name":"el.xref"},{"k":"ref","name":"el.ext-link"},{"k":"ref","name":"el.fn"},{"k":"ref","name":"el.std"},{"k":"ref","name":"el.mixed-citation"},{"k":"ref","name":"el.inline-formula"}]}]},
  "cm.mark": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.mark"}]}]}]},
  "cm.phrase": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.phrase"}]}]}]},
  "cm.label": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.phrase"},{"k":"ref","name":"el.inline-formula"},{"k":"ref","name":"el.fn"},{"k":"ref","name":"el.xref"}]}]}]},
  "cm.term": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.phrase"},{"k":"ref","name":"el.inline-formula"},{"k":"ref","name":"el.ext-link"},{"k":"ref","name":"el.fn"},{"k":"ref","name":"el.xref"}]}]}]},
  "cm.citation": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.format"},{"k":"ref","name":"el.named-content"},{"k":"ref","name":"el.inline-code"},{"k":"ref","name":"el.inline-graphic"},{"k":"ref","name":"el.break"},{"k":"ref","name":"el.xref"},{"k":"ref","name":"el.ext-link"},{"k":"ref","name":"el.fn"},{"k":"ref","name":"el.std"},{"k":"ref","name":"el.inline-formula"},{"k":"ref","name":"el.uri"}]}]}]},
  "cm.subsup": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"el.sub"},{"k":"ref","name":"el.sup"}]}]}]},
  "el.bold": {"k":"group","c":[{"k":"element","name":"bold","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.italic": {"k":"group","c":[{"k":"element","name":"italic","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.underline": {"k":"group","c":[{"k":"element","name":"underline","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.strike": {"k":"group","c":[{"k":"element","name":"strike","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.monospace": {"k":"group","c":[{"k":"element","name":"monospace","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.sup": {"k":"group","c":[{"k":"element","name":"sup","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.sub": {"k":"group","c":[{"k":"element","name":"sub","ns":"","c":[{"k":"ref","name":"cm.mark"}]}]},
  "el.named-content": {"k":"group","c":[{"k":"element","name":"named-content","ns":"","c":[{"k":"attribute","name":"content-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"variable"},{"k":"data","type":"token","c":[{"k":"except","c":[{"k":"value","v":"variable"}]}]}]}]},{"k":"ref","name":"cm.term"}]}]},
  "el.inline-code": {"k":"group","c":[{"k":"element","name":"inline-code","ns":"","c":[{"k":"text"}]}]},
  "el.break": {"k":"group","c":[{"k":"element","name":"break","ns":"","c":[{"k":"empty"}]}]},
  "el.label": {"k":"group","c":[{"k":"element","name":"label","ns":"","c":[{"k":"ref","name":"cm.label"}]}]},
  "el.title": {"k":"group","c":[{"k":"element","name":"title","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]},
  "el.p": {"k":"group","c":[{"k":"element","name":"p","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"content-type","ns":"","c":[{"k":"value","v":"dimension"}]}]},{"k":"optional","c":[{"k":"attribute","name":"style-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"align-left"},{"k":"value","v":"align-right"},{"k":"value","v":"align-center"}]}]}]},{"k":"optional","c":[{"k":"attribute","name":"specific-use","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"ref","name":"cm.inline"}]}]},
  "el.processing-meta": {"k":"group","c":[{"k":"element","name":"processing-meta","ns":"","c":[{"k":"attribute","name":"base-tagset","ns":"","c":[{"k":"value","v":"interchange"}]},{"k":"attribute","name":"mathml-version","ns":"","c":[{"k":"value","v":"3.0"}]},{"k":"attribute","name":"table-model","ns":"","c":[{"k":"value","v":"xhtml"}]},{"k":"attribute","name":"terminology-model","ns":"","c":[{"k":"value","v":"tbx"}]},{"k":"attribute","name":"math-representation","ns":"","c":[{"k":"value","v":"mathml"}]},{"k":"attribute","name":"tagset-family","ns":"","c":[{"k":"value","v":"sts"}]},{"k":"optional","c":[{"k":"ref","name":"el.custom-meta-group"}]}]}]},
  "el.custom-meta-group": {"k":"group","c":[{"k":"element","name":"custom-meta-group","ns":"","c":[{"k":"oneOrMore","c":[{"k":"element","name":"custom-meta","ns":"","c":[{"k":"element","name":"meta-name","ns":"","c":[{"k":"text"}]},{"k":"element","name":"meta-value","ns":"","c":[{"k":"ref","name":"cm.term"}]}]}]}]}]},
  "el.std-meta": {"k":"group","c":[{"k":"element","name":"std-meta","ns":"","c":[{"k":"interleave","c":[{"k":"optional","c":[{"k":"element","name":"std-type","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.title-wrap"}]},{"k":"optional","c":[{"k":"element","name":"proj-id","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"element","name":"release-version","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.std-ident"}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.std-org"},{"k":"ref","name":"el.std-org-group"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"content-language","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.std-ref"}]},{"k":"optional","c":[{"k":"element","name":"doc-ref","ns":"","c":[{"k":"text"}]}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.release-date"}]},{"k":"optional","c":[{"k":"ref","name":"el.implementation-date"}]},{"k":"optional","c":[{"k":"element","name":"equivalence","ns":"","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.any"},{"k":"ref","name":"el.std-ref"}]}]}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"comm-ref","ns":"","c":[{"k":"text"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"secretariat","ns":"","c":[{"k":"text"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"ics","ns":"","c":[{"k":"text"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"ccs","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"element","name":"page-count","ns":"","c":[{"k":"attribute","name":"count","ns":"","c":[{"k":"data","type":"nonNegativeInteger"}]},{"k":"empty"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"std-supersedes","ns":"","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.any"},{"k":"ref","name":"el.std-ref"}]}]}]}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.std-xref"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.permissions"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.custom-meta-group"}]}]}]}]},
  "el.std-xref": {"k":"group","c":[{"k":"element","name":"std-xref","ns":"","c":[{"k":"attribute","name":"type","ns":"","c":[{"k":"value","v":"revises"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.std-ref"}]}]}]},
  "el.title-wrap": {"k":"group","c":[{"k":"element","name":"title-wrap","ns":"","c":[{"k":"ref","name":"attr.xml-lang.req"},{"k":"optional","c":[{"k":"element","name":"intro","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]},{"k":"optional","c":[{"k":"element","name":"main","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]},{"k":"optional","c":[{"k":"element","name":"compl","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]},{"k":"optional","c":[{"k":"element","name":"full","ns":"","c":[{"k":"ref","name":"cm.inline"}]}]}]}]},
  "el.std-ident": {"k":"group","c":[{"k":"element","name":"std-ident","ns":"","c":[{"k":"optional","c":[{"k":"element","name":"originator","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"element","name":"doc-type","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"element","name":"doc-number","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"element","name":"part-number","ns":"","c":[{"k":"text"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.edition"}]},{"k":"optional","c":[{"k":"element","name":"version","ns":"","c":[{"k":"ref","name":"cm.subsup"}]}]}]}]},
  "el.edition": {"k":"group","c":[{"k":"element","name":"edition","ns":"","c":[{"k":"ref","name":"cm.subsup"}]}]},
  "el.std-org-group": {"k":"group","c":[{"k":"element","name":"std-org-group","ns":"","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.std-org"}]}]}]},
  "el.std-org": {"k":"group","c":[{"k":"element","name":"std-org","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"std-org-level","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"optional","c":[{"k":"attribute","name":"std-org-role","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"optional","c":[{"k":"attribute","name":"std-org-type","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"std-org-name","ns":"","c":[{"k":"ref","name":"cm.subsup"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"std-org-abbrev","ns":"","c":[{"k":"ref","name":"cm.subsup"}]}]}]}]},
  "el.release-date": {"k":"group","c":[{"k":"element","name":"release-date","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"date-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"published"},{"k":"value","v":"implemented"}]}]}]},{"k":"data","type":"date"}]}]},
  "el.implementation-date": {"k":"group","c":[{"k":"element","name":"implementation-date","ns":"","c":[{"k":"data","type":"date"}]}]},
  "el.permissions": {"k":"group","c":[{"k":"element","name":"permissions","ns":"","c":[{"k":"zeroOrMore","c":[{"k":"element","name":"copyright-statement","ns":"","c":[{"k":"ref","name":"cm.phrase"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"copyright-year","ns":"","c":[{"k":"text"}]}]},{"k":"zeroOrMore","c":[{"k":"element","name":"copyright-holder","ns":"","c":[{"k":"ref","name":"cm.subsup"}]}]}]}]},
  "el.standard": {"k":"group","c":[{"k":"element","name":"standard","ns":"","c":[{"k":"optional","c":[{"k":"ref","name":"el.processing-meta"}]},{"k":"ref","name":"el.front"},{"k":"ref","name":"el.body"},{"k":"optional","c":[{"k":"ref","name":"el.back"}]}]}]},
  "el.front": {"k":"group","c":[{"k":"element","name":"front","ns":"","c":[{"k":"ref","name":"el.std-meta"},{"k":"optional","c":[{"k":"ref","name":"el.sec.foreword"}]},{"k":"optional","c":[{"k":"ref","name":"el.sec.intro"}]}]}]},
  "el.body": {"k":"group","c":[{"k":"element","name":"body","ns":"","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.sec.chapter"}]}]}]},
  "el.back": {"k":"group","c":[{"k":"element","name":"back","ns":"","c":[{"k":"optional","c":[{"k":"ref","name":"el.app-group"}]},{"k":"optional","c":[{"k":"ref","name":"el.ref-list"}]},{"k":"optional","c":[{"k":"ref","name":"el.index"}]}]}]},
  "el.sec.foreword": {"k":"group","c":[{"k":"element","name":"sec","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"attribute","name":"sec-type","ns":"","c":[{"k":"value","v":"foreword"}]},{"k":"ref","name":"el.title"},{"k":"ref","name":"cm.sec-content"}]}]},
  "el.sec.intro": {"k":"group","c":[{"k":"element","name":"sec","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"attribute","name":"sec-type","ns":"","c":[{"k":"value","v":"intro"}]},{"k":"ref","name":"el.title"},{"k":"ref","name":"cm.sec-content"}]}]},
  "el.sec.chapter": {"k":"group","c":[{"k":"element","name":"sec","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"sec-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"scope"},{"k":"value","v":"norm-refs"},{"k":"value","v":"terms"},{"k":"value","v":"norm_refs"},{"k":"ref","name":"dt.sec-type.other"}]}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"ref","name":"el.title"},{"k":"ref","name":"cm.sec-content"}]}]},
  "el.sec.nested": {"k":"group","c":[{"k":"element","name":"sec","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"sec-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"numbered-paragraph"},{"k":"ref","name":"dt.sec-type.other"}]}]}]},{"k":"choice","c":[{"k":"group","c":[{"k":"ref","name":"el.label"},{"k":"optional","c":[{"k":"ref","name":"el.title"}]}]},{"k":"ref","name":"el.title"}]},{"k":"ref","name":"cm.sec-content"}]}]},
  "dt.sec-type.other": {"k":"group","c":[{"k":"data","type":"token","c":[{"k":"except","c":[{"k":"choice","c":[{"k":"value","v":"foreword"},{"k":"value","v":"intro"},{"k":"value","v":"scope"},{"k":"value","v":"norm-refs"},{"k":"value","v":"norm_refs"},{"k":"value","v":"terms"},{"k":"value","v":"numbered-paragraph"}]}]}]}]},
  "cm.sec-content": {"k":"group","c":[{"k":"zeroOrMore","c":[{"k":"ref","name":"block.any"}]},{"k":"optional","c":[{"k":"group","c":[{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.sec.nested"},{"k":"ref","name":"el.term-sec"}]}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"block.trailing"}]}]}]}]},
  "block.trailing": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"el.non-normative-note"},{"k":"ref","name":"el.non-normative-example"},{"k":"ref","name":"el.ref-list"}]}]},
  "block.any": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"el.p"},{"k":"ref","name":"el.list"},{"k":"ref","name":"el.non-normative-note"},{"k":"ref","name":"el.non-normative-example"},{"k":"ref","name":"el.disp-quote"},{"k":"ref","name":"el.code"},{"k":"ref","name":"el.table-wrap"},{"k":"ref","name":"el.array"},{"k":"ref","name":"el.fig"},{"k":"ref","name":"el.fig-group"},{"k":"ref","name":"el.disp-formula"},{"k":"ref","name":"el.disp-formula-group"},{"k":"ref","name":"el.graphic"},{"k":"ref","name":"el.def-list"},{"k":"ref","name":"el.ref-list"}]}]},
  "el.term-sec": {"k":"group","c":[{"k":"element","name":"term-sec","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"sec-type","ns":"","c":[{"k":"data","type":"token"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"ref","name":"el.tbx-termEntry"}]}]},
  "el.app-group": {"k":"group","c":[{"k":"element","name":"app-group","ns":"","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.app"}]}]}]},
  "el.app": {"k":"group","c":[{"k":"element","name":"app","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"attribute","name":"content-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"informative"},{"k":"value","v":"normative"},{"k":"value","v":"inform-annex"},{"k":"value","v":"inform_annex"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"optional","c":[{"k":"element","name":"annex-type","ns":"","c":[{"k":"text"}]}]},{"k":"ref","name":"el.title"},{"k":"ref","name":"cm.sec-content"}]}]},
  "el.index": {"k":"group","c":[{"k":"element","name":"index","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.index-title-group"}]},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.index-div"},{"k":"ref","name":"el.index-entry"}]}]}]}]},
  "el.index-title-group": {"k":"group","c":[{"k":"element","name":"index-title-group","ns":"","c":[{"k":"ref","name":"el.title"}]}]},
  "el.index-div": {"k":"group","c":[{"k":"element","name":"index-div","ns":"","c":[{"k":"optional","c":[{"k":"ref","name":"el.index-title-group"}]},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.index-entry"},{"k":"ref","name":"el.index-div"}]}]}]}]},
  "el.index-entry": {"k":"group","c":[{"k":"element","name":"index-entry","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"element","name":"term","ns":"","c":[{"k":"ref","name":"cm.term"}]},{"k":"zeroOrMore","c":[{"k":"element","name":"see-entry","ns":"","c":[{"k":"ref","name":"cm.term"}]}]}]}]},
  "el.list": {"k":"group","c":[{"k":"element","name":"list","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"attribute","name":"list-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"alpha-lower"},{"k":"value","v":"arabic"},{"k":"value","v":"roman-lower"},{"k":"value","v":"dash"},{"k":"value","v":"bullet"}]}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.list-item"}]}]}]},
  "el.list-item": {"k":"group","c":[{"k":"element","name":"list-item","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.p"},{"k":"ref","name":"el.list"}]}]}]}]},
  "el.non-normative-note": {"k":"group","c":[{"k":"element","name":"non-normative-note","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"content-type","ns":"","c":[{"k":"value","v":"warning"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"cm.note-block"}]}]}]},
  "el.non-normative-example": {"k":"group","c":[{"k":"element","name":"non-normative-example","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"cm.note-block"}]}]}]},
  "cm.note-block": {"k":"group","c":[{"k":"choice","c":[{"k":"ref","name":"el.p"},{"k":"ref","name":"el.list"},{"k":"ref","name":"el.code"},{"k":"ref","name":"el.disp-formula"}]}]},
  "el.disp-quote": {"k":"group","c":[{"k":"element","name":"disp-quote","ns":"","c":[{"k":"oneOrMore","c":[{"k":"ref","name":"el.p"}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"element","name":"attrib","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"specific-use","ns":"","c":[{"k":"value","v":"source"}]}]},{"k":"ref","name":"cm.mark"}]},{"k":"ref","name":"el.permissions"}]}]}]}]},
  "el.array": {"k":"group","c":[{"k":"element","name":"array","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"attribute","name":"orientation","ns":"","c":[{"k":"ref","name":"dt.orientation"}]}]},{"k":"ref","name":"el.table"}]}]},
  "el.code": {"k":"group","c":[{"k":"element","name":"code","ns":"","c":[{"k":"text"}]}]},
  "el.mml-math": {"k":"group","c":[{"k":"element","name":"math","ns":"http://www.w3.org/1998/Math/MathML","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"attribute","name":"id","ns":"","c":[{"k":"data","type":"NCName"}]},{"k":"attribute","name":"display","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"block"},{"k":"value","v":"inline"}]}]},{"k":"attribute","c":[{"k":"anyName","c":[{"k":"except","c":[{"k":"name","ns":"","v":"id"},{"k":"name","ns":"","v":"display"}]}]}]}]}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"mml.any"}]}]}]}]},
  "mml.any": {"k":"group","c":[{"k":"element","c":[{"k":"nsName","ns":"http://www.w3.org/1998/Math/MathML"},{"k":"zeroOrMore","c":[{"k":"attribute","c":[{"k":"anyName"}]}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"mml.any"}]}]}]}]},
  "el.disp-formula-group": {"k":"group","c":[{"k":"element","name":"disp-formula-group","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"optional","c":[{"k":"ref","name":"el.caption"}]},{"k":"optional","c":[{"k":"ref","name":"el.legend"}]},{"k":"oneOrMore","c":[{"k":"choice","c":[{"k":"ref","name":"el.disp-formula"},{"k":"ref","name":"el.disp-formula-group"}]}]}]}]},
  "el.inline-formula": {"k":"group","c":[{"k":"element","name":"inline-formula","ns":"","c":[{"k":"ref","name":"el.mml-math"}]}]},
  "el.disp-formula": {"k":"group","c":[{"k":"element","name":"disp-formula","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"interleave","c":[{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"ref","name":"el.mml-math"},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.non-normative-note"}]},{"k":"optional","c":[{"k":"ref","name":"el.legend"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.graphic"}]}]}]}]},
  "el.xref": {"k":"group","c":[{"k":"element","name":"xref","ns":"","c":[{"k":"choice","c":[{"k":"group","c":[{"k":"attribute","name":"ref-type","ns":"","c":[{"k":"value","v":"custom"}]},{"k":"optional","c":[{"k":"attribute","name":"custom-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"term-entry"},{"k":"value","v":"note"},{"k":"value","v":"example"}]}]}]}]},{"k":"attribute","name":"ref-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"abbreviation"},{"k":"value","v":"app"},{"k":"value","v":"bibr"},{"k":"value","v":"disp-formula"},{"k":"value","v":"fig"},{"k":"value","v":"fn"},{"k":"value","v":"sec"},{"k":"value","v":"table"},{"k":"value","v":"table-fn"},{"k":"value","v":"list"},{"k":"value","v":"chem"},{"k":"value","v":"other"}]}]}]},{"k":"attribute","name":"rid","ns":"","c":[{"k":"list","c":[{"k":"oneOrMore","c":[{"k":"data","type":"NCName"}]}]}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"inline.phrase"},{"k":"element","name":"label","ns":"","c":[{"k":"ref","name":"cm.phrase"}]}]}]}]}]},
  "el.ext-link": {"k":"group","c":[{"k":"element","name":"ext-link","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"ext-link-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"uri"},{"k":"data","type":"token","c":[{"k":"except","c":[{"k":"value","v":"uri"}]}]}]}]}]},{"k":"ref","name":"attr.xlink-href.req"},{"k":"ref","name":"attr.xlink-type"},{"k":"ref","name":"cm.phrase"}]}]},
  "el.uri": {"k":"group","c":[{"k":"element","name":"uri","ns":"","c":[{"k":"ref","name":"attr.xlink-type"},{"k":"text"}]}]},
  "el.fn": {"k":"group","c":[{"k":"element","name":"fn","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"oneOrMore","c":[{"k":"ref","name":"el.p"}]}]}]},
  "el.std": {"k":"group","c":[{"k":"element","name":"std","ns":"","c":[{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"el.std-ref"},{"k":"ref","name":"el.title"}]}]}]}]},
  "el.std-ref": {"k":"group","c":[{"k":"element","name":"std-ref","ns":"","c":[{"k":"optional","c":[{"k":"attribute","name":"type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"dated"},{"k":"value","v":"undated"}]}]}]},{"k":"zeroOrMore","c":[{"k":"choice","c":[{"k":"text"},{"k":"ref","name":"el.edition"}]}]}]}]},
  "el.mixed-citation": {"k":"group","c":[{"k":"element","name":"mixed-citation","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"ref","name":"attr.xlink-type"},{"k":"ref","name":"cm.citation"}]}]},
  "el.ref-list": {"k":"group","c":[{"k":"element","name":"ref-list","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"attribute","name":"content-type","ns":"","c":[{"k":"choice","c":[{"k":"value","v":"bibl"},{"k":"value","v":"norm-refs"},{"k":"value","v":"bibr"},{"k":"value","v":"norm_refs"}]}]},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"optional","c":[{"k":"ref","name":"el.title"}]},{"k":"zeroOrMore","c":[{"k":"ref","name":"el.ref"}]}]}]},
  "el.ref": {"k":"group","c":[{"k":"element","name":"ref","ns":"","c":[{"k":"ref","name":"attr.id"},{"k":"optional","c":[{"k":"ref","name":"el.label"}]},{"k":"choice","c":[{"k":"ref","name":"el.std"},{"k":"ref","name":"el.mixed-citation"}]}]}]},
}
const children = (p: Pattern) => p.c ?? []
const ncStart = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const ncName = new RegExp(`^[${ncStart}][${ncStart}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u')
const key = (n: XmlName) => `${n.ns ?? ''}|${n.local}`
const nameKey = (p: Pattern) => `${p.ns ?? ''}|${p.name ?? ''}`
function nameMatches(pattern: Pattern, name: XmlName): boolean {
  if (pattern.name !== undefined) return nameKey(pattern) === key(name)
  const cls = children(pattern)[0]
  if (!cls) return false
  if (cls.k === 'choice') return children(cls).some(c => c.k === 'name' && `${c.ns ?? ''}|${c.v ?? ''}` === key(name))
  if (cls.k === 'nsName') return (name.ns ?? '') === (cls.ns ?? '')
  if (cls.k !== 'anyName') return false
  const excluded = children(cls).find(c => c.k === 'except')
  return !excluded || !children(excluded).some(c => c.k === 'name' && `${c.ns ?? ''}|${c.v ?? ''}` === key(name))
}
function scalar(p: Pattern, value: string): boolean {
  if (p.k === 'ref') return !!p.name && scalar(grammar[p.name], value)
  if (p.k === 'value') return value.trim() === p.v
  if (p.k === 'text') return true
  if (p.k === 'choice') return children(p).some(c => scalar(c, value))
  if (p.k === 'group') return children(p).every(c => scalar(c, value))
  if (p.k === 'list') return value.trim().split(/\s+/).every(v => scalar(children(p)[0], v))
  if (p.k === 'oneOrMore' || p.k === 'zeroOrMore' || p.k === 'optional') return scalar(children(p)[0], value)
  if (p.k !== 'data') return p.k === 'empty'
  const v = p.type === 'token' ? value.trim().replace(/\s+/g, ' ') : value
  if (p.type === 'NCName' && !ncName.test(v)) return false
  if (p.type === 'nonNegativeInteger' && !/^\d+$/.test(v)) return false
  if (p.type === 'positiveInteger' && (!/^\d+$/.test(v) || Number(v) < 1)) return false
  const params = children(p).filter(c => c.k === 'param')
  for (const param of params) {
    if (param.name === 'minLength' && v.length < Number(param.v)) return false
    if (param.name === 'pattern' && !new RegExp(`^(?:${param.v})$`).test(v)) return false
  }
  const excluded = children(p).find(c => c.k === 'except')
  return !excluded || !children(excluded).some(c => scalar(c, v))
}
function firstNames(p: Pattern, seen = new Set<string>()): Set<string> {
  if (p.k === 'element') {
    if (p.name !== undefined) return new Set([nameKey(p)])
    const cls = children(p)[0]
    if (cls?.k === 'choice') return new Set(children(cls).filter(c => c.k === 'name').map(c => `${c.ns ?? ''}|${c.v ?? ''}`))
    return new Set(['*'])
  }
  if (p.k === 'ref') {
    if (!p.name || seen.has(p.name)) return new Set()
    const next = new Set(seen); next.add(p.name)
    return firstNames(grammar[p.name], next)
  }
  const result = new Set<string>()
  for (const c of children(p)) for (const n of firstNames(c, seen)) result.add(n)
  return result
}
function unique(states: State[]): State[] {
  const seen = new Set<string>()
  return states.filter(s => { const k = `${s.i}:${s.mask}`; if (seen.has(k)) return false; seen.add(k); return true })
}
/** 每个元素独立匹配 RNG，属性无序、子元素保持顺序。 */
const DEFAULT_WORK_LIMIT = 4_000_000
class MatchLimit extends Error {
  element: XmlElement
  constructor(element: XmlElement) { super('内容模型匹配超限'); this.element = element }
}
export function validateRngModel(tree: XmlDocument, maxWork = DEFAULT_WORK_LIMIT): ImportProblem[] {
  let remaining = maxWork
  const work = (amount: number, element: XmlElement) => {
    remaining -= amount
    if (remaining < 0) throw new MatchLimit(element)
  }
  const failures: Array<{ element: XmlElement; depth: number }> = []
  const elementCache = new WeakMap<XmlElement, WeakMap<Pattern, boolean>>()
  const validateElement = (p: Pattern, el: XmlElement, depth: number): boolean => {
    work(1, el)
    if (!nameMatches(p, el.name)) return false
    // math.rng 允许 MathML 后代的任意名称和属性；单次遍历避免通配属性的组合爆炸。
    if (p.name === 'math' && p.ns === MATHML_NS) {
      work(el.attrs.length, el)
      const id = el.attrs.find(a => a.name.ns === null && a.name.local === 'id')
      const display = el.attrs.find(a => a.name.ns === null && a.name.local === 'display')
      if ((id && !ncName.test(id.value)) || (display && !['block', 'inline'].includes(display.value))) {
        failures.push({ element: el, depth }); return false
      }
      const pending = el.children.filter(isXmlElement)
      while (pending.length) {
        const child = pending.pop()!
        work(1 + child.attrs.length, child)
        if (child.name.ns !== MATHML_NS) { failures.push({ element: child, depth: depth + 1 }); return false }
        for (const c of child.children) if (isXmlElement(c)) pending.push(c)
      }
      return true
    }
    const cached = elementCache.get(el)?.get(p)
    if (cached !== undefined) return cached
    const tokens: Token[] = []
    for (const c of el.children) {
      if (c.type === 'element') tokens.push(c)
      else if (c.type === 'text' && c.value.trim()) tokens.push(c.value)
    }
    const attrs = el.attrs
    work(attrs.length, el)
    const start = (1n << BigInt(attrs.length)) - 1n
    const body = children(p).filter((c, i) => !['anyName', 'nsName', 'name'].includes(c.k) && !(i === 0 && p.name === undefined && c.k === 'choice' && children(c).every(n => n.k === 'name')))
    const memo = new WeakMap<Pattern, WeakMap<Token[], Map<string, State[]>>>()
    let memoEntries = 0
    const match = (pat: Pattern, input: Token[], state: State): State[] => {
      work(1, el)
      const stateKey = `${state.i}:${state.mask}`
      const found = memo.get(pat)?.get(input)?.get(stateKey)
      if (found) return found
      const result = evaluate(pat, input, state)
      // 缓存数量有上限，输入规模不能无限扩大单元素的缓存。
      if (memoEntries < 8192) {
        let byInput = memo.get(pat)
        if (!byInput) { byInput = new WeakMap(); memo.set(pat, byInput) }
        let byState = byInput.get(input)
        if (!byState) { byState = new Map(); byInput.set(input, byState) }
        byState.set(stateKey, result); memoEntries++
      }
      return result
    }
    const evaluate = (pat: Pattern, input: Token[], state: State): State[] => {
      const cs = children(pat)
      switch (pat.k) {
        case 'ref': return pat.name && grammar[pat.name] ? match(grammar[pat.name], input, state) : []
        case 'empty': return [state]
        case 'group': {
          let states = [state]
          for (const c of cs) states = unique(states.flatMap(s => match(c, input, s)))
          return states
        }
        case 'choice': return unique(cs.flatMap(c => match(c, input, state)))
        case 'optional': return unique([state, ...cs.flatMap(c => match(c, input, state))])
        case 'zeroOrMore':
        case 'oneOrMore': {
          const pattern: Pattern = cs.length === 1 ? cs[0] : { k: 'group', c: cs }
          let frontier = pat.k === 'oneOrMore' ? match(pattern, input, state) : [state]
          const all = unique(frontier)
          const visited = new Set(all.map(s => `${s.i}:${s.mask}`))
          while (frontier.length) {
            const next = unique(frontier.flatMap(s => match(pattern, input, s))).filter(s => {
              const k = `${s.i}:${s.mask}`
              if (visited.has(k)) return false
              visited.add(k); return true
            })
            for (const item of next) all.push(item)
            frontier = next
          }
          return all
        }
        case 'attribute': {
          work(attrs.length, el)
          const valuePatterns = cs.filter(c => !['anyName', 'nsName', 'name'].includes(c.k))
          const matches = attrs.flatMap((a: XmlAttr, i) => {
            const bit = 1n << BigInt(i)
            if (!(state.mask & bit) || !nameMatches(pat, a.name) || !valuePatterns.every(c => scalar(c, a.value))) return []
            return [{ i: state.i, mask: state.mask & ~bit }]
          })
          // 重复的 MathML 通配属性模型相同，按输入次序消费以避免子集枚举。
          return pat.name === undefined ? matches.slice(0, 1) : matches
        }
        case 'element': {
          const token = input[state.i]
          return token && typeof token !== 'string' && validateElement(pat, token, depth + 1) ? [{ i: state.i + 1, mask: state.mask }] : []
        }
        case 'text': return typeof input[state.i] === 'string' ? [state, { i: state.i + 1, mask: state.mask }] : [state]
        case 'data': case 'value': case 'list': {
          const token = input[state.i]
          if (typeof token === 'string') return scalar(pat, token) ? [{ i: state.i + 1, mask: state.mask }] : []
          return scalar(pat, '') ? [state] : []
        }
        case 'interleave': {
          const buckets: Token[][] = cs.map(() => [])
          const allowed = cs.map(c => firstNames(c))
          let end = state.i
          while (end < input.length) {
            const token = input[end]
            if (typeof token === 'string') break
            const at = allowed.findIndex(names => names.has(key(token.name)) || names.has('*'))
            if (at < 0) break
            buckets[at].push(token); end++
          }
          let states = [{ i: 0, mask: state.mask }]
          for (let j = 0; j < cs.length; j++) {
            states = unique(states.flatMap(s => match(cs[j], buckets[j], { i: 0, mask: s.mask }).filter(x => x.i === buckets[j].length)))
          }
          return states.map(s => ({ i: end, mask: s.mask }))
        }
        default: return []
      }
    }
    const result = match({ k: 'group', c: body }, tokens, { i: 0, mask: start }).some(s => s.i === tokens.length && s.mask === 0n)
    if (!result) failures.push({ element: el, depth })
    let cache = elementCache.get(el)
    if (!cache) { cache = new WeakMap(); elementCache.set(el, cache) }
    cache.set(p, result)
    return result
  }
  try {
    const start = children(grammar['el.standard'])[0]
    if (validateElement(start, tree.root, 0)) return []
    const failure = failures.reduce((best, x) => x.depth > best.depth ? x : best, {element: tree.root, depth: 0})
    return [{ code: 'xml-content-model', severity: 'error', message: '元素内容、属性、次序或数量不符合内容模型', xml: location(failure.element), detail: { rule: 'RNG' } }]
  } catch (error) {
    if (!(error instanceof MatchLimit)) throw error
    return [{ code: 'xml-limit', severity: 'error', message: 'XML 内容模型匹配超过计算限额', xml: location(error.element), detail: { rule: 'RNG-LIMIT', maxWork } }]
  }
}
