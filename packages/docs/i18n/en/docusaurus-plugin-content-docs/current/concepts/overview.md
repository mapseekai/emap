---
id: overview
slug: /concepts/overview
title: Concepts Overview
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# Concepts Overview

emap is organized around maps, sources, and layers.

## Map

`Emap` binds to a browser container and owns the viewport, controls, interaction handlers, and render scheduling.

## Source

`TopologySource` stores a mapshaper dataset and converts GeoJSON, TopoJSON, Shapefile ZIP, GeoParquet, or GeoArrow input into renderable topology data.

## Layer

Layers come from the mapshaper layers inside a source. After you register a source with `map.addSource(...)`, its layers participate in rendering, querying, and editing.

## Extent

After loading data, applications typically call `map.setExtent(source.getExtent())` to move the camera to the source bounds.
