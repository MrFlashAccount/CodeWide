import { View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { colors } from "../../../theme";
import { onboardingStyles as styles } from "./onboarding.styles";

const CARD = colors.surfaceContainerHigh;
const CARD_EDGE = "#464646";
const CHROME = "#343434";
const DIM = "#777777";
const MUTED = "#A0A0A0";
const PAPER = colors.primary;
const RED = "#5A2530";
const GREEN = "#16452A";
const GREEN_INK = "#61D492";

/** Static layered preview of the overview, guided review, and changes surfaces. */
export function ReviewInboxIllustration(): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.welcomeIllustration}
      testID="review-inbox-illustration"
    >
      <Svg height="100%" viewBox="0 0 980 720" width="100%">
        <OverviewCard />
        <GuideCard />
        <ChangesCard />
      </Svg>
    </View>
  );
}

function OverviewCard(): React.JSX.Element {
  return (
    <G transform="rotate(-7 232 365)">
      <Rect fill={CARD} height="540" rx="26" stroke={CARD_EDGE} width="330" x="66" y="95" />
      <Rect fill={CHROME} height="66" rx="26" width="330" x="66" y="95" />
      <Rect fill={CHROME} height="30" width="330" x="66" y="131" />
      <Circle cx="92" cy="128" fill="#404040" r="12" />
      <Rect fill={MUTED} height="10" opacity="0.78" rx="5" width="98" x="116" y="116" />
      <Rect fill={DIM} height="7" opacity="0.48" rx="3.5" width="72" x="116" y="136" />
      <Circle cx="372" cy="119" fill={MUTED} r="3" />
      <Circle cx="372" cy="130" fill={MUTED} r="3" />
      <Circle cx="372" cy="141" fill={MUTED} r="3" />
      <Rect fill={PAPER} height="3" opacity="0.9" rx="1.5" width="208" x="126" y="188" />
      <Circle cx="104" cy="224" fill="#17472D" r="14" />
      <Path
        d="m97 224 5 5 9-11"
        fill="none"
        stroke={GREEN_INK}
        strokeLinecap="round"
        strokeWidth="3"
      />
      <Rect fill={MUTED} height="10" opacity="0.72" rx="5" width="126" x="132" y="211" />
      <Rect fill={DIM} height="7" opacity="0.38" rx="3.5" width="176" x="132" y="232" />
      <Rect fill="#202020" height="100" rx="17" stroke="#3B3B3B" width="278" x="92" y="268" />
      <Circle cx="120" cy="298" fill="#17472D" r="12" />
      <Path
        d="m114 298 4 4 8-10"
        fill="none"
        stroke={GREEN_INK}
        strokeLinecap="round"
        strokeWidth="2.5"
      />
      <Rect fill={MUTED} height="9" opacity="0.72" rx="4.5" width="112" x="144" y="287" />
      <Rect fill={DIM} height="7" opacity="0.35" rx="3.5" width="156" x="144" y="308" />
      <Rect fill={DIM} height="7" opacity="0.24" rx="3.5" width="116" x="144" y="328" />
      <Rect fill="#202020" height="100" rx="17" stroke="#3B3B3B" width="278" x="92" y="384" />
      <Circle cx="120" cy="414" fill="#17472D" r="12" />
      <Path
        d="m114 414 4 4 8-10"
        fill="none"
        stroke={GREEN_INK}
        strokeLinecap="round"
        strokeWidth="2.5"
      />
      <Rect fill={MUTED} height="9" opacity="0.72" rx="4.5" width="134" x="144" y="403" />
      <Rect fill={DIM} height="7" opacity="0.35" rx="3.5" width="168" x="144" y="424" />
      <Rect fill={DIM} height="7" opacity="0.24" rx="3.5" width="126" x="144" y="444" />
      <Rect fill="#202020" height="92" rx="17" stroke="#3B3B3B" width="278" x="92" y="500" />
      <Circle cx="120" cy="530" fill="#3F3F3F" r="12" />
      <Line
        stroke={MUTED}
        strokeLinecap="round"
        strokeWidth="2"
        x1="115"
        x2="125"
        y1="530"
        y2="530"
      />
      <Rect fill={MUTED} height="9" opacity="0.64" rx="4.5" width="120" x="144" y="520" />
      <Rect fill={GREEN_INK} height="7" opacity="0.92" rx="3.5" width="148" x="144" y="550" />
    </G>
  );
}

function GuideCard(): React.JSX.Element {
  return (
    <G transform="rotate(7 746 365)">
      <Rect fill={CARD} height="540" rx="26" stroke={CARD_EDGE} width="330" x="584" y="95" />
      <Rect fill={CHROME} height="66" rx="26" width="330" x="584" y="95" />
      <Rect fill={CHROME} height="30" width="330" x="584" y="131" />
      <Circle cx="610" cy="128" fill="#404040" r="12" />
      <Rect fill={MUTED} height="10" opacity="0.78" rx="5" width="98" x="634" y="116" />
      <Rect fill={DIM} height="7" opacity="0.48" rx="3.5" width="72" x="634" y="136" />
      <Circle cx="890" cy="119" fill={MUTED} r="3" />
      <Circle cx="890" cy="130" fill={MUTED} r="3" />
      <Circle cx="890" cy="141" fill={MUTED} r="3" />
      <Rect fill={PAPER} height="4" rx="2" width="74" x="614" y="190" />
      <Rect fill={PAPER} height="4" rx="2" width="74" x="696" y="190" />
      <Rect fill="#555555" height="4" rx="2" width="74" x="778" y="190" />
      <Rect fill={MUTED} height="10" opacity="0.72" rx="5" width="148" x="614" y="222" />
      <Rect fill={DIM} height="7" opacity="0.35" rx="3.5" width="204" x="614" y="244" />
      <Rect fill="#1D1D1D" height="246" rx="18" stroke="#3B3B3B" width="278" x="610" y="280" />
      <Rect fill="#3B3425" height="32" width="234" x="632" y="316" />
      <Rect fill="#877A60" height="7" opacity="0.55" rx="3.5" width="142" x="644" y="328" />
      <Rect fill={RED} height="32" width="234" x="632" y="358" />
      <Rect fill="#EE7D96" height="7" opacity="0.8" rx="3.5" width="116" x="644" y="370" />
      <Rect fill={GREEN} height="32" width="234" x="632" y="400" />
      <Rect fill={GREEN_INK} height="7" opacity="0.86" rx="3.5" width="168" x="644" y="412" />
      <Rect fill={GREEN} height="32" width="234" x="632" y="442" />
      <Rect fill={GREEN_INK} height="7" opacity="0.86" rx="3.5" width="148" x="644" y="454" />
      <Rect fill={DIM} height="7" opacity="0.28" rx="3.5" width="156" x="632" y="492" />
      <Rect fill="#3C3C3C" height="38" rx="19" width="94" x="670" y="550" />
      <Rect fill={PAPER} height="38" rx="19" width="94" x="772" y="550" />
      <Path
        d="m808 568 5 5 10-12"
        fill="none"
        stroke="#222"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <Rect fill="#333333" height="7" opacity="0.7" rx="3.5" width="25" x="830" y="565" />
    </G>
  );
}

function ChangesCard(): React.JSX.Element {
  return (
    <G>
      <Rect
        fill="#2D2D2D"
        height="626"
        rx="28"
        stroke="#505050"
        strokeWidth="2"
        width="440"
        x="270"
        y="44"
      />
      <Rect fill={CHROME} height="72" rx="28" width="440" x="270" y="44" />
      <Rect fill={CHROME} height="32" width="440" x="270" y="84" />
      <Path
        d="m306 80 12-12m-12 12 12 12m-12-12h28"
        fill="none"
        stroke={MUTED}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <Rect fill="#C8C8C8" height="11" opacity="0.86" rx="5.5" width="150" x="352" y="62" />
      <Rect fill={DIM} height="7" opacity="0.5" rx="3.5" width="104" x="352" y="83" />
      <Rect fill={DIM} height="8" opacity="0.55" rx="4" width="86" x="318" y="146" />
      <Rect fill="#D6D6D6" height="8" opacity="0.9" rx="4" width="86" x="448" y="146" />
      <Rect fill={PAPER} height="3" rx="1.5" width="116" x="432" y="168" />
      <Rect fill="#222222" height="42" rx="14" stroke="#3E3E3E" width="256" x="302" y="192" />
      <Rect fill="#4A4A4A" height="34" rx="11" width="120" x="306" y="196" />
      <Circle cx="330" cy="213" fill={PAPER} r="7" />
      <Path d="m326 213 3 3 6-7" fill="none" stroke="#333" strokeLinecap="round" strokeWidth="2" />
      <Rect fill={MUTED} height="7" opacity="0.8" rx="3.5" width="46" x="344" y="209.5" />
      <Rect fill={DIM} height="7" opacity="0.54" rx="3.5" width="52" x="460" y="209.5" />
      <Rect fill="#202020" height="346" rx="18" stroke="#3C3C3C" width="124" x="302" y="252" />
      <Rect fill="#3D3D3D" height="78" rx="12" width="100" x="314" y="264" />
      <Rect fill={MUTED} height="8" opacity="0.75" rx="4" width="54" x="326" y="278" />
      <Rect fill={GREEN_INK} height="7" rx="3.5" width="20" x="386" y="278.5" />
      <Rect fill={DIM} height="7" opacity="0.38" rx="3.5" width="68" x="326" y="300" />
      <Rect fill={DIM} height="7" opacity="0.28" rx="3.5" width="54" x="326" y="319" />
      <Line stroke="#373737" x1="314" x2="414" y1="360" y2="360" />
      <Rect fill={MUTED} height="8" opacity="0.68" rx="4" width="66" x="326" y="379" />
      <Rect fill={GREEN_INK} height="7" rx="3.5" width="18" x="388" y="379.5" />
      <Rect fill={DIM} height="7" opacity="0.3" rx="3.5" width="52" x="326" y="401" />
      <Line stroke="#373737" x1="314" x2="414" y1="442" y2="442" />
      <Rect fill={MUTED} height="8" opacity="0.68" rx="4" width="62" x="326" y="461" />
      <Rect fill={GREEN_INK} height="7" rx="3.5" width="18" x="388" y="461.5" />
      <Rect fill={DIM} height="7" opacity="0.3" rx="3.5" width="48" x="326" y="483" />
      <Rect fill="#1B1B1B" height="346" rx="18" stroke="#3C3C3C" width="246" x="442" y="252" />
      <Rect fill={CHROME} height="46" rx="18" width="246" x="442" y="252" />
      <Rect fill={CHROME} height="22" width="246" x="442" y="276" />
      <Rect fill={MUTED} height="8" opacity="0.72" rx="4" width="86" x="460" y="271" />
      <Rect fill={GREEN_INK} height="7" rx="3.5" width="25" x="644" y="271.5" />
      <Rect fill="#3B3425" height="30" width="210" x="460" y="316" />
      <Rect fill={RED} height="30" width="210" x="460" y="355" />
      <Rect fill="#F1849B" height="7" opacity="0.86" rx="3.5" width="106" x="472" y="366.5" />
      <Rect fill={GREEN} height="30" width="210" x="460" y="394" />
      <Rect fill={GREEN_INK} height="7" opacity="0.9" rx="3.5" width="158" x="472" y="405.5" />
      <Rect fill={GREEN} height="30" width="210" x="460" y="433" />
      <Rect fill={GREEN_INK} height="7" opacity="0.9" rx="3.5" width="136" x="472" y="444.5" />
      <Rect fill="#373737" height="98" rx="14" stroke="#4A4A4A" width="210" x="460" y="482" />
      <Rect fill={MUTED} height="7" opacity="0.38" rx="3.5" width="58" x="474" y="498" />
      <Rect fill={MUTED} height="8" opacity="0.72" rx="4" width="164" x="474" y="524" />
      <Rect fill={DIM} height="8" opacity="0.58" rx="4" width="132" x="474" y="545" />
      <Circle cx="486" cy="566" fill={DIM} r="5" />
      <Circle cx="514" cy="566" fill={DIM} r="5" />
      <Rect fill={PAPER} height="20" rx="10" width="48" x="540" y="556" />
      <Path
        d="m556 566 4 4 8-10"
        fill="none"
        stroke="#222"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
      <Rect fill={PAPER} height="38" rx="19" width="368" x="306" y="614" />
      <Circle cx="526" cy="633" fill="#222" r="5" />
      <Rect fill="#222" height="8" opacity="0.76" rx="4" width="72" x="540" y="629" />
    </G>
  );
}
