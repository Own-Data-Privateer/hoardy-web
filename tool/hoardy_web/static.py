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

"""Templates for the generated pages."""

style = """
    html { background-color: #eee; font-family: sans-serif; }
    body { background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px; }
    center p { font-size: 200%; }
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
        <title>
        %if pattern is not None:
            hoardy-web: {{results_size}} visits to {{results_len}} URLs matching `{{selector}}` and `{{pattern}}`
        %else:
            hoardy-web: {{results_size}} visits to `{{url}}`
        %end
        </title>
        <style>@STYLE@</style>
    </head>
    <body>
        %if not_found and pattern is None:
        <center>
            <h1>No pages with this exact URL can be found in the index</h1>
            <p><a href="{{net_url}}" referrerpolicy="no-referrer"><code>{{url}}</code></a></p>
        </center>

        <p>Either this URL was never archived or <code>hoardy-web serve</code> was invoked without indexing archives containing this URL. You can also try archiving this URL by clicking the above link.</p>
        %end

        <h1>{{matching}} (<code>{{matching_kind}}</code>)</h1>

        %if results_len > 0:
        <ul>
            %for inet_url in results.keys():
            %pretty_inet_url = pretty(inet_url)
            <li>
                <p>
                    <code>{{pretty_inet_url}}</code>
                    %if pretty_inet_url != inet_url:
                    (<code>{{inet_url}}</code>)
                    %end
                    <a class="right" href="{{inet_url}}" referrerpolicy="no-referrer">[visit it again]</a>
                </p>
                <ul>
                %for istime, irrexpr in results[inet_url]:
                    %ts = url_fmtts(inet_url, istime)
                    %reqres = irrexpr.reqres
                    %request = reqres.request
                    %response = reqres.response
                    %method = request.method
                    %qsize = len(request.body)
                    %rsize = 0 if response is None else len(response.body)
                    <li><a href="/web/{{ts}}/{{inet_url}}">[{{ts}}] {{method}} {{qsize // 1024}}KiB {{rsize // 1024}}KiB</a></li>
                %end
                </ul>
            </li>
            %end
        </ul>
        %else:
        <p>(Empty.)</p>
        %end

        <h2>Explanation</h2>

        <p>The above list contains index entries satisfying at least one of the following conditions:</p>

        <ul>
        %for e, d in explained_selector:
            <li>{{e}} <code>{{d}}</code></li>
        %end
        </ul>

        <p>which also satisfy any of the following conditions:</p>

        <ul>
        %if pattern is None:
            <li><code>net_url</code> (network-encoded URL) of an index entry is equal to <code>{{net_url}}</code></li>
        %else:
            <li><code>pretty_net_url</code> (IDNA-decoded minimally-quoted URL) of an index entry matches regular expression <code>{{pattern}}</code></li>
        %end
        </ul>

        <p>The URLs are sorted by <code>rhostname</code> (<code>hostname</code> with the order of parts reversed, e.g. <code>org.example.www</code>), followed by concatenation of unquoted <code>path</code> and <code>query</code> URL components.</p>

        <p>The visits are sorted by date, with each visit specifying its HTTP method, request size, and response size.</p>
    </body>
</html>
""".replace(
    "@STYLE@", style
)
