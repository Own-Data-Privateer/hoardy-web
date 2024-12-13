# Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of `hoardy-web` project.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.

style = """
  html { background-color: #eee; font-family: sans-serif; }
  body { background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px; }
  a, code { overflow-wrap: anywhere; }
  pre, code { background-color: #eee; border: 1px solid #ddd; padding: 5px; }
  ul { margin: 10px; }
  .right { float: right; }
"""

locate_page_stpl = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %if matching:
    <title>hoardy-web: {{visits_total}} visits to {{len(url_visits)}} URLs matching {{selector}} and {{pattern}}</title>
    %elif visits_total > 0:
    <title>hoardy-web: Not Found, but have {{visits_total}} visits to {{len(url_visits)}} URLs matching {{pattern}}</title>
    %else:
    <title>hoardy-web: Not Found</title>
    %end
    <style>@STYLE@</style>
  </head>
  <body>
    %if matching:
    <h1>Between {{start}} and {{end}}, matching <code>{{pattern}}</code></h1>
    %else:
    <h1>Not found <code>{{pretty_net_url}}</code> in the index</h1>
    <p>Either it was not archived yet or <code>hoardy-web serve</code> was invoked without indexing a location containing archives of this URL.</p>
    <p>You can try <a href="{{net_url}}" referrerpolicy="no-referrer">visiting it</a>. That usually helps.</p>
    <h2>Similar URLs in the index, matching <code>{{pattern}}</code></h2>
    %end
    %if visits_total > 0:
    <ul>
    %for net_url, pretty_net_url, visits in url_visits:
      <li><code>{{pretty_net_url}}</code> <a class="right" href="{{net_url}}" referrerpolicy="no-referrer">[visit it again]</a>
        <ul>
        %for v in visits:
          <li>@<a href="/web/{{v}}/{{net_url}}">[{{v}}]</a></li>
        %end
        </ul>
      </li>
    %end
    </ul>
    %else:
    <p>(Only tumble-weed blown around by winds can be seen here.)</p>
    %end
  </body>
</html>
""".replace("@STYLE@", style)
