import { useLayoutEffect, useRef } from "react";
import type { NationStructure } from "../application/nation-view";
import { SCENE_HEIGHT, SCENE_WIDTH } from "./nation-motion-paths";
import { structureViewBox } from "./nation-structure-geometry";

type Status = NationStructure["status"];

function StructureArt({
  kind,
  status,
}: {
  kind: NationStructure["kind"];
  status: Status;
}) {
  const active = status === "busy" || status === "peak";
  const peak = status === "peak";
  const light = active ? "#ffe394" : "#d9e7d9";
  const roof = status === "quiet" ? "#879e9b" : "#e99562";
  const wall = status === "quiet" ? "#9eaeaa" : "#f4d8aa";
  const blue = status === "quiet" ? "#648898" : "#3988a7";
  const glass = status === "quiet" ? "#89a8ae" : "#b1e4ec";
  const green = status === "quiet" ? "#88a677" : "#72b870";

  switch (kind) {
    case "house":
      return (
        <>
          <path d="M13 43 50 17 88 43v43H13Z" fill={wall} />
          <path d="M7 45 50 13 94 45 84 49 50 27 17 50Z" fill={roof} />
          <path d="M66 24V9h11v23" fill="#ddc5a4" />
          <path d="M41 86V59h18v27" fill="#53818b" />
          <path d="M21 53h13v14H21Zm45 0h13v14H66Z" fill={light} />
          <path d="M13 85h75" stroke="#fff2cc" strokeWidth="3" />
        </>
      );
    case "apartment":
      return (
        <>
          <path d="M17 26 75 17 86 24v64H17Z" fill={wall} />
          <path d="M17 26 75 17l11 7-57 11Z" fill={roof} />
          <path d="M29 35v52M75 28v59" stroke="#b2886b" strokeWidth="3" />
          {[0, 1, 2].map((row) => (
            <path
              key={row}
              d={`M36 ${39 + row * 15}h12v9H36Zm21 0h12v9H57Z`}
              fill={row === 2 && !active ? glass : light}
            />
          ))}
          <path d="M20 88h69" stroke="#fff0ca" strokeWidth="3" />
        </>
      );
    case "office":
      return (
        <>
          <path d="M19 87V24l51-13 13 9v67Z" fill={blue} />
          <path d="M70 11v76h13V20Z" fill="#2b617c" />
          <path d="M25 29 65 19v57L25 83Z" fill={glass} />
          <path
            d="M35 26v55m15-59v57M24 43l42-8M24 61l42-6"
            stroke="#e8f5db"
            strokeWidth="3"
            opacity=".85"
          />
          <path d="M18 88h68" stroke="#fff2c9" strokeWidth="3" />
          {active && (
            <path d="M73 31v8m0 9v8m0 9v8" stroke={light} strokeWidth="4" />
          )}
        </>
      );
    case "tower":
      return (
        <>
          <path d="M28 89V24l16-8V9h19v10l12 7v63Z" fill={blue} />
          <path d="M28 24 44 16v73H28ZM63 19l12 7v63H63Z" fill="#24657f" />
          <path d="M46 4h15v8H46Z" fill={roof} />
          <path d="M49 4V0m7 4V0" stroke="#f6dfae" strokeWidth="2" />
          {[35, 48, 61, 74].map((y) => (
            <path
              key={y}
              d={`M34 ${y}h35`}
              stroke={active ? light : glass}
              strokeWidth="5"
              strokeDasharray="8 4"
            />
          ))}
          <path d="M20 89h64" stroke="#fff2c9" strokeWidth="3" />
        </>
      );
    case "workshop":
      return (
        <>
          <path d="M12 48 37 34l20 7 22-11 9 8v48H12Z" fill="#c7d7c8" />
          <path d="M12 48 37 34l20 7 22-11 9 8-23 11-23-7-21 14Z" fill={roof} />
          <path d="M22 62h20v24H22Z" fill={blue} />
          <path d="M55 59h20v14H55Z" fill={light} />
          <path d="M12 87h77" stroke="#fff1cf" strokeWidth="3" />
        </>
      );
    case "factory":
      return (
        <>
          <path d="M12 51 34 37v12l23-14v14l22-13v51H12Z" fill="#d5dbd0" />
          <path
            d="M14 52 34 39v12l23-14v14l22-13"
            fill="none"
            stroke={roof}
            strokeWidth="7"
          />
          <path d="M72 35V9h12v78H72Z" fill="#d37965" />
          <path d="M16 65h17v12H16Zm25 0h17v12H41Z" fill={light} />
          <path d="M11 87h77" stroke="#fff1cf" strokeWidth="3" />
          {active && (
            <path
              d="M79 6c-5-5 5-7 0-11"
              fill="none"
              stroke="#f8f1dc"
              strokeWidth="5"
              opacity=".8"
            />
          )}
        </>
      );
    case "plant":
      return (
        <>
          <path d="M9 45h82v42H9Z" fill="#d4dcd4" />
          <path d="M9 45 27 35h47l17 10Z" fill={roof} />
          <path d="M18 50v37m63-37v37" stroke="#7e9b9d" strokeWidth="4" />
          <path d="M22 19h12v27H22Zm42-11h11v38H64Z" fill="#bd7568" />
          <path d="M36 61h22v26H36Z" fill={blue} />
          <path d="M11 88h81" stroke="#fff1cf" strokeWidth="3" />
          {active && (
            <path
              d="M28 14c-5-7 6-8 0-15M70 4c-5-7 6-8 0-15"
              fill="none"
              stroke="#fff3de"
              strokeWidth="4"
              opacity=".8"
            />
          )}
        </>
      );
    case "depot":
      return (
        <>
          <path d="M8 45 51 26l42 15v46H8Z" fill="#d9d6bd" />
          <path d="M5 46 51 24l45 18-9 9-38-15-35 19Z" fill={roof} />
          <path d="M20 58h56v29H20Z" fill={blue} />
          <path
            d="M24 61v24m16-24v24m16-24v24m16-24v24"
            stroke="#d8e9dc"
            strokeWidth="3"
          />
          <path d="M7 88h87" stroke="#fff1cf" strokeWidth="3" />
          {active && <path d="M79 68h12v13H79Z" fill="#f2bd71" />}
        </>
      );
    case "warehouse":
      return (
        <>
          <path d="M12 46 48 24l39 18v45H12Z" fill="#dfd9c2" />
          <path d="M8 47 48 20l44 22-6 10-38-18-33 22Z" fill="#cf8a65" />
          <path d="M25 62h21v25H25Zm31 0h21v25H56Z" fill={blue} />
          <path d="M11 88h80" stroke="#fff2d2" strokeWidth="3" />
          {active && (
            <path d="M32 67h7m24 0h7" stroke={light} strokeWidth="4" />
          )}
        </>
      );
    case "quay":
      return (
        <>
          <path d="M7 43h85v21H7Z" fill="#cfb993" />
          <path d="M7 43 25 29h64l3 14Z" fill="#eee0b9" />
          <path
            d="M14 64v25m27-25v25m27-25v25m18-25v25"
            stroke="#735e54"
            strokeWidth="7"
          />
          <path
            d="M21 36h18v9H21Zm26-5h17v14H47Z"
            fill={active ? "#e99a5f" : "#8ba7a5"}
          />
          <path d="M6 89h88" stroke="#e7f8e9" strokeWidth="3" opacity=".75" />
        </>
      );
    case "crane":
      return (
        <>
          <path
            d="M18 86h66M28 82 45 32l17 50M27 80h38M31 69h29M36 55h20"
            fill="none"
            stroke="#d86850"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path d="M43 29 87 18l4 6-45 14Z" fill="#eb9863" />
          <path d="M45 30 35 15h21l5 13" fill="#d86850" />
          <path
            d="M82 22v38m-6 0h12l-6 8Z"
            fill="none"
            stroke="#665c56"
            strokeWidth="3"
          />
          <path d="M18 88h67" stroke="#f9dfb6" strokeWidth="4" />
          {peak && <circle cx="82" cy="62" r="4" fill={light} />}
        </>
      );
    case "terminal":
      return (
        <>
          <path d="M8 41 50 24l43 17v47H8Z" fill="#d5dbd0" />
          <path d="M7 41 50 20l45 19-7 10-38-17-36 18Z" fill="#4d91a8" />
          <path d="M18 55h64v21H18Z" fill={glass} />
          <path
            d="M29 55v21m20-21v21m21-21v21"
            stroke="#497987"
            strokeWidth="4"
          />
          <path d="M12 87h80" stroke="#fff0cf" strokeWidth="3" />
          {active && <path d="M23 80h54" stroke={light} strokeWidth="4" />}
        </>
      );
    case "field":
      return (
        <>
          <path d="M5 53 75 30l20 25-69 34Z" fill="#d3ad65" />
          <path
            d="M6 56 75 34M12 67l69-27M19 78l69-27M29 87l65-31"
            stroke={green}
            strokeWidth="8"
          />
          <path d="M9 53 76 30M26 89l69-34" stroke="#fff0ae" strokeWidth="3" />
          {active && (
            <path
              d="M36 49v-19m0 0-5 7m5-7 5 7M66 63V42m0 0-5 7m5-7 5 7"
              stroke="#f4e6a3"
              strokeWidth="3"
            />
          )}
        </>
      );
    case "greenhouse":
      return (
        <>
          <path
            d="M9 87V49c0-21 18-35 41-35s41 14 41 35v38Z"
            fill="#b9e1d9"
            opacity=".86"
          />
          <path
            d="M9 87V49c0-21 18-35 41-35s41 14 41 35v38M30 86V26m20 60V15m20 71V26M9 53h82"
            fill="none"
            stroke="#eef4d7"
            strokeWidth="5"
          />
          <path
            d="M18 82q9-18 19 0m7 0q9-18 19 0m4 0q9-18 19 0"
            fill="none"
            stroke={green}
            strokeWidth="6"
          />
          <path d="M7 88h86" stroke="#d1b989" strokeWidth="4" />
        </>
      );
    case "hangar":
      return (
        <>
          <path d="M7 87V50Q13 24 50 21q38 3 43 29v37Z" fill="#d3ddd9" />
          <path
            d="M7 50Q13 24 50 21q38 3 43 29"
            fill="none"
            stroke="#5c9bb0"
            strokeWidth="10"
          />
          <path d="M19 57h62v30H19Z" fill={blue} />
          <path d="M48 56v31M22 73h57" stroke="#d4e9e6" strokeWidth="3" />
          <path d="M8 88h85" stroke="#fff0d0" strokeWidth="3" />
          {active && (
            <path d="M35 61h10m12 0h10" stroke={light} strokeWidth="3" />
          )}
        </>
      );
    case "station":
      return (
        <>
          <path d="M13 88V47l37-20 38 20v41Z" fill="#e8dcc1" />
          <path d="M8 48 50 22l43 26-6 8-37-23-36 23Z" fill={roof} />
          <path d="M21 59h58v21H21Z" fill={blue} />
          <path d="M37 59v21m26-21v21" stroke="#d7e9dc" strokeWidth="3" />
          <path d="M5 88h90M15 94h70" stroke="#607c76" strokeWidth="4" />
          {active && <path d="M39 43h22" stroke={light} strokeWidth="5" />}
        </>
      );
    case "solar":
      return (
        <>
          <path d="M11 80 30 35h61L72 80Z" fill="#286780" />
          <path
            d="M30 35h61M23 51h61M17 66h61M11 80h61M49 35 30 80m40-45L51 80"
            stroke="#a5d5d2"
            strokeWidth="3"
          />
          <path d="M27 81v8m40-8v8M11 90h67" stroke="#6d8b75" strokeWidth="5" />
          {active && (
            <path
              d="m47 37-7 12 10-3-7 14"
              fill="none"
              stroke="#fff5b5"
              strokeWidth="3"
            />
          )}
        </>
      );
    case "turbine":
      return (
        <>
          <path d="M44 88 48 27h6l5 61Z" fill="#f4f4df" />
          <circle cx="51" cy="29" r="7" fill="#e9eee2" />
          <path
            d="M51 28 47 2 54 0l4 24M49 30 23 47l-4-6 23-19M52 30l26 17 3-7-25-17"
            fill="#f4f4df"
          />
          <path d="M31 89h43" stroke="#bad0af" strokeWidth="5" />
          {peak && <circle cx="51" cy="29" r="3" fill={light} />}
        </>
      );
    case "substation":
      return (
        <>
          <path d="M5 76 26 59h69v29H5Z" fill="#e4dcc2" />
          <path d="M5 76 26 59h69l-17 17Z" fill="#b2c9c2" />
          <path
            d="M21 67V25m45 39V21M12 29h66M16 40h57"
            fill="none"
            stroke="#607f82"
            strokeWidth="5"
          />
          <path d="M24 17h55v20H24Z" fill={blue} />
          <path
            d="M28 17v20m17-20v20m17-20v20"
            stroke="#a9d5d2"
            strokeWidth="3"
          />
          <path d="M5 88h90" stroke="#fff0cc" strokeWidth="4" />
          {active && <circle cx="76" cy="23" r="4" fill={light} />}
        </>
      );
    case "pylon":
      return (
        <>
          <path
            d="M49 9 20 89m31-80 29 80M36 48h30M29 67h44M18 90h66"
            fill="none"
            stroke="#e9e7d3"
            strokeWidth="6"
          />
          <path
            d="M18 30h64M25 40h50M34 18h34"
            fill="none"
            stroke="#668991"
            strokeWidth="4"
          />
          <path
            d="M17 30q-13 20-22 0m87 0q13 20 22 0"
            fill="none"
            stroke="#d0d9c8"
            strokeWidth="2"
          />
          {peak && <circle cx="50" cy="10" r="3" fill={light} />}
        </>
      );
    default:
      return null;
  }
}

/** Small fixed facilities sit on the same cover crop as the painted scene. */
export function NationStructures({
  structures,
}: {
  structures: readonly NationStructure[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const bounds = svg.getBoundingClientRect();
      svg.setAttribute(
        "viewBox",
        structureViewBox(bounds.width, bounds.height),
      );
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(svg);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return (
    <svg
      ref={svgRef}
      className="nation-structures"
      viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
      preserveAspectRatio="none"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      aria-hidden="true"
      focusable="false"
      data-layer="Structures"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {structures.map(({ id, kind, x, y, width, height, status }) => (
        <svg
          key={id}
          x={x}
          y={y}
          width={width}
          height={height}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          data-structure={id}
          data-kind={kind}
          data-status={status}
          opacity={status === "quiet" ? 0.78 : status === "steady" ? 0.9 : 1}
        >
          <ellipse
            cx="51"
            cy="89"
            rx="45"
            ry="8"
            fill="#275b61"
            opacity=".22"
          />
          <StructureArt kind={kind} status={status} />
        </svg>
      ))}
    </svg>
  );
}
