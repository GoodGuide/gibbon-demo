#!/usr/bin/env ruby

require 'bundler'
Bundler.require

require 'pathname'
here = Pathname.new(__FILE__).dirname

load here.join('app.rb')

map '/public' do
  run Rack::File.new(here.join('public'))
end

map '/vendor' do
  run Rack::File.new(here.join('vendor'))
end

run GibbonPadApp
