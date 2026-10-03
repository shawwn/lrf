const M = require(require("path").join(__dirname, "../../../../js/lrf_model.js"));
const s = M.make_spec("dlem20");
const r = x => Math.round(x);
const T = M.TARGETS;
console.log("predicted ratings", JSON.stringify(M.predicted_ratings(s), (k, v) => typeof v === "number" ? r(v) : v));
for (const [k, t] of Object.entries(T)) {
  console.log(k.padEnd(14), [1, 2, 5, 10, 25].map(hz => r(M.detection_range(s, t, 1 / hz).range_m)).join("/"),
    " F@100 " + M.fraction_on_target(s, t, 100).toFixed(3), " F@700 " + M.fraction_on_target(s, t, 700).toExponential(2));
}
console.log("footprint 100 m", M.beam_diameter(s, 100).toFixed(4), "1 km", M.beam_diameter(s, 1000).toFixed(3),
  "quad crossover", r(M.crossover_range(s, T.quad10_side.size_m)));
console.log("opt t 25 m/s", M.optimal_measurement_time(s, 25).toFixed(3), "50 m/s", M.optimal_measurement_time(s, 50).toFixed(3));
console.log("narrower 0.6:", r(M.detection_range(M.make_spec("dlem20", {divergence_mrad: 0.6}), T.quad10_side, 0.5).range_m));
for (const off of [0, 0.15, 0.3, 0.45, 0.6]) console.log(" quad side, aim off", off, "mrad @450 m:", (M.fraction_on_target(s, T.quad10_side, 450, 0, off * 0.45) / M.fraction_on_target(s, T.quad10_side, 450)).toFixed(3));
