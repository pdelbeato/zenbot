#!/bin/sh

env node --max-old-space-size=8192 zenbot.js $@ 
