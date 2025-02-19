# 3D Gaussian splatting for CesiumJS

CesiumJS-based implemetation of a renderer for [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for generating 3D scenes from 2D images. Their project is CUDA-based and needs to run natively on your machine, but I wanted to build a viewer that was accessible via the web.

The 3D scenes are stored in a format similar to point clouds and can be viewed, navigated, and interacted with in real-time. This renderer will work with standard `.splat` files.

When I started, web-based viewers were already available -- A WebGL-based viewer from [antimatter15](https://github.com/antimatter15/splat) and a WebGPU viewer from [cvlab-epfl](https://github.com/cvlab-epfl/gaussian-splatting-web) -- However no Three.js version existed. I used those versions as a starting point for my initial implementation, but as of now this project contains all my own code.
<br>
<br>
## How to use

pnpm install

node server.js

Open http://localhost:8081/index.html?url=http://localhost:8081/data/model.splat

url is the path to your .splat file.