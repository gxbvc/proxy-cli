#!/usr/bin/env ruby
# Adds the Webshare residential proxy login to a Rails app's encrypted credentials WITHOUT printing it.
#
#   BUNDLE_GEMFILE=<app>/Gemfile bundle exec ruby ~/tools/proxy-cli/bin/add-webshare-residential-credentials.rb <app dir>
#
# Reads WEBSHARE_RESIDENTIAL_USER and WEBSHARE_RESIDENTIAL_PASS from ~/tools/proxy-cli/.env on this Mac, appends
#   webshare_residential:
#     user: ...
#     pass: ...
# to <app>/config/credentials.yml.enc (needs <app>/config/master.key), and prints only "ok" and lengths.
# Refuses to run if the block already exists. Then commit config/credentials.yml.enc and deploy as usual.
require "active_support"
require "active_support/encrypted_configuration"
require "yaml"

app = File.expand_path(ARGV[0] || abort("usage: add-webshare-residential-credentials.rb <app dir>"))
env_file = File.expand_path("~/tools/proxy-cli/.env")
env = File.readlines(env_file, chomp: true).reject { |l| l.strip.start_with?("#") || !l.include?("=") }
          .to_h { |l| k, v = l.split("=", 2); [k.strip, v.strip.delete_prefix('"').delete_suffix('"')] }
user = env["WEBSHARE_RESIDENTIAL_USER"].to_s
pass = env["WEBSHARE_RESIDENTIAL_PASS"].to_s
abort "the residential login is missing in #{env_file}" if user.empty? || pass.empty?

Dir.chdir(app)
cfg = ActiveSupport::EncryptedConfiguration.new(config_path: "config/credentials.yml.enc", key_path: "config/master.key",
                                                env_key: "RAILS_MASTER_KEY", raise_if_missing_key: true)
text = cfg.read
abort "webshare_residential already exists in #{app}; not changing anything" if text =~ /^webshare_residential:/

block = { "webshare_residential" => { "user" => user, "pass" => pass } }.to_yaml.sub(/\A---\n/, "")
cfg.write(text.chomp + "\n\n" + block)

back = YAML.safe_load(cfg.read, permitted_classes: [Symbol], aliases: true)
saved = back["webshare_residential"] || {}
abort "write check failed" unless saved["user"] == user && saved["pass"] == pass
puts "ok: webshare_residential.user (#{user.length} chars) and .pass (#{pass.length} chars) added to #{app}/config/credentials.yml.enc"
